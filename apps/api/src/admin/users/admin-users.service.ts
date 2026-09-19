import { randomBytes } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import type {
  AdminCreateStaffRequest,
  AdminRole,
  AdminStaffCredentialResult,
  AdminStaffList,
  AdminStaffMember,
  AdminUpdateStaffRequest,
} from "@sakura/contracts";
import { asc, eq } from "drizzle-orm";
import { InvalidInputError, ResourceNotFoundError } from "../../common/errors";
import { AuditService } from "../../audit";
import { DbService } from "../../db/db.service";
import type { Transaction } from "../../db/db.types";
import { adminUsers } from "../../db/schema";
import { AdminAuthService } from "../auth/admin-auth.service";
import { hashPassword } from "../auth/password";
import type { AccessClaims } from "../auth/tokens";

/** Who did it and from where, threaded through to every audit entry. */
export type AdminUsersContext = {
  actor: AccessClaims;
  ipAddress?: string;
  userAgent?: string;
};

type StaffRow = typeof adminUsers.$inferSelect;

/**
 * The staff list: who can sign in to the panel, and as what.
 *
 * ## The rules, and where each one lives
 *
 * Every change runs in one transaction that starts by locking the whole
 * `admin_users` table's rows — a dozen at most, so this costs nothing — in id
 * order. That serialises user management outright, and it is what makes the
 * last-admin rule below hold under concurrency: two owners demoting each
 * other in the same second would each see the other still standing if they
 * checked without the lock, and the shop would end up with nobody who can
 * grant access back.
 *
 * - **Nobody changes their own role, disables themselves, or resets their own
 *   password here.** Each is a way to lock yourself out mid-click; the second
 *   admin, if there is one, is who does it.
 * - **There is always at least one active ADMIN.** Demoting or disabling the
 *   last one is refused, because nothing in the panel could undo it.
 * - **A role change, a disable, or a password reset signs the person out
 *   everywhere**, through `AdminAuthService.signOutEverywhere` — the one
 *   mechanism that revokes an access token before it expires. A packer
 *   promoted to STAFF signs in again and gets the new rail; one who has left
 *   is locked out on their very next request.
 * - **Accounts are disabled, never deleted.** `audit_log` references this
 *   table, and a departed employee's history is exactly what must survive.
 *
 * Every change writes an audit entry in the same transaction. The password is
 * never in one: a reset is recorded as having happened, by whom, and nothing
 * more.
 */
@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly authService: AdminAuthService,
    private readonly auditService: AuditService,
  ) {}

  /** Active accounts first, then by when they were added. */
  async list(viewer: AccessClaims): Promise<AdminStaffList> {
    const rows = await this.dbService.db
      .select()
      .from(adminUsers)
      .orderBy(asc(adminUsers.disabledAt), asc(adminUsers.createdAt));

    return { items: rows.map((row) => toStaffMember(row, viewer)) };
  }

  async create(
    request: AdminCreateStaffRequest,
    context: AdminUsersContext,
  ): Promise<AdminStaffCredentialResult> {
    const temporaryPassword = generatePassword();
    const passwordHash = await hashPassword(temporaryPassword);

    const row = await this.dbService.db.transaction(async (tx) => {
      const staff = await lockStaff(tx);

      /* A readable refusal rather than the unique constraint's 409. The
         constraint still stands behind this — a race past the lock is not
         possible, but a psql session is — and the error mapper turns it into
         a clean conflict if it ever fires. */
      if (staff.some((member) => member.email === request.email)) {
        throw new InvalidInputError(
          `There is already an account for ${request.email}. Change its role or re-enable it instead.`,
          { email: request.email },
        );
      }

      const [created] = await tx
        .insert(adminUsers)
        .values({
          email: request.email,
          name: request.name,
          role: request.role,
          passwordHash,
        })
        .returning();

      await this.auditService.record(
        {
          ...auditContext(context),
          action: "CREATE",
          entityType: "admin_users",
          entityId: created!.email,
          after: { email: created!.email, name: created!.name, role: created!.role },
        },
        tx,
      );

      return created!;
    });

    this.logger.log(`${context.actor.email} added ${row.email} as ${row.role}`);

    return { user: toStaffMember(row, context.actor), temporaryPassword };
  }

  async update(
    id: string,
    request: AdminUpdateStaffRequest,
    context: AdminUsersContext,
  ): Promise<AdminStaffMember> {
    const row = await this.dbService.db.transaction(async (tx) => {
      const staff = await lockStaff(tx);
      const target = requireMember(staff, id);

      const roleChanges = request.role !== undefined && request.role !== target.role;

      if (roleChanges) {
        refuseSelf(target, context, "change your own role");

        if (target.role === "ADMIN") refuseLastAdmin(staff, target, "change the role of");
      }

      const [updated] = await tx
        .update(adminUsers)
        .set({
          ...(request.name !== undefined ? { name: request.name } : {}),
          ...(roleChanges ? { role: request.role } : {}),
        })
        .where(eq(adminUsers.id, target.id))
        .returning();

      // A token signed for the old role must not outlive the change — see
      // the class comment. The name alone changes nothing a token carries.
      if (roleChanges) await this.authService.signOutEverywhere(target.id, tx);

      await this.auditService.record(
        {
          ...auditContext(context),
          action: "UPDATE",
          entityType: "admin_users",
          entityId: target.email,
          before: { name: target.name, role: target.role },
          after: { name: updated!.name, role: updated!.role },
        },
        tx,
      );

      return updated!;
    });

    return toStaffMember(row, context.actor);
  }

  async disable(id: string, context: AdminUsersContext): Promise<AdminStaffMember> {
    const row = await this.dbService.db.transaction(async (tx) => {
      const staff = await lockStaff(tx);
      const target = requireMember(staff, id);

      // Already off: nothing to do, and nothing worth an audit entry.
      if (target.disabledAt) return target;

      refuseSelf(target, context, "disable your own account");

      if (target.role === "ADMIN") refuseLastAdmin(staff, target, "disable");

      const [updated] = await tx
        .update(adminUsers)
        .set({ disabledAt: new Date() })
        .where(eq(adminUsers.id, target.id))
        .returning();

      await this.authService.signOutEverywhere(target.id, tx);

      await this.auditService.record(
        {
          ...auditContext(context),
          action: "UPDATE",
          entityType: "admin_users",
          entityId: target.email,
          before: { disabled: false },
          after: { disabled: true },
        },
        tx,
      );

      return updated!;
    });

    return toStaffMember(row, context.actor);
  }

  /**
   * Switch an account back on. Also clears a login lockout: the owner doing
   * this has decided the person should be able to sign in now, and making
   * them wait out fifteen minutes of someone else's typos is not that.
   */
  async enable(id: string, context: AdminUsersContext): Promise<AdminStaffMember> {
    const row = await this.dbService.db.transaction(async (tx) => {
      const staff = await lockStaff(tx);
      const target = requireMember(staff, id);

      if (!target.disabledAt) return target;

      const [updated] = await tx
        .update(adminUsers)
        .set({ disabledAt: null, failedLoginAttempts: 0, lockedUntil: null })
        .where(eq(adminUsers.id, target.id))
        .returning();

      await this.auditService.record(
        {
          ...auditContext(context),
          action: "UPDATE",
          entityType: "admin_users",
          entityId: target.email,
          before: { disabled: true },
          after: { disabled: false },
        },
        tx,
      );

      return updated!;
    });

    return toStaffMember(row, context.actor);
  }

  /**
   * Replace someone's password with a fresh one, shown once.
   *
   * For the packer who forgot theirs, and for the account whose password the
   * owner handed over and now wants rotated. Clears a lockout for the same
   * reason `enable` does, and signs them out everywhere, because whoever was
   * holding the old password should not keep a session it minted.
   */
  async resetPassword(id: string, context: AdminUsersContext): Promise<AdminStaffCredentialResult> {
    const temporaryPassword = generatePassword();
    const passwordHash = await hashPassword(temporaryPassword);

    const row = await this.dbService.db.transaction(async (tx) => {
      const staff = await lockStaff(tx);
      const target = requireMember(staff, id);

      refuseSelf(target, context, "reset your own password");

      const [updated] = await tx
        .update(adminUsers)
        .set({ passwordHash, failedLoginAttempts: 0, lockedUntil: null })
        .where(eq(adminUsers.id, target.id))
        .returning();

      await this.authService.signOutEverywhere(target.id, tx);

      await this.auditService.record(
        {
          ...auditContext(context),
          action: "UPDATE",
          entityType: "admin_users",
          entityId: target.email,
          after: { passwordReset: true },
        },
        tx,
      );

      return updated!;
    });

    this.logger.log(`${context.actor.email} reset the password for ${row.email}`);

    return { user: toStaffMember(row, context.actor), temporaryPassword };
  }
}

/**
 * Every staff row, locked, in id order.
 *
 * The id order is what keeps two of these transactions from deadlocking on
 * each other: both take the same locks in the same sequence, so the second
 * simply waits for the first.
 */
function lockStaff(tx: Transaction): Promise<StaffRow[]> {
  return tx.select().from(adminUsers).orderBy(asc(adminUsers.id)).for("update");
}

function requireMember(staff: StaffRow[], id: string): StaffRow {
  const target = staff.find((member) => member.id === id);

  if (!target) throw new ResourceNotFoundError("Staff account", id);

  return target;
}

function refuseSelf(target: StaffRow, context: AdminUsersContext, what: string): void {
  if (target.id === context.actor.sub) {
    throw new InvalidInputError(`You can't ${what} from here. Ask another admin to do it.`);
  }
}

/** Refuse if `target` is the only active ADMIN left. */
function refuseLastAdmin(staff: StaffRow[], target: StaffRow, what: string): void {
  const otherActiveAdmin = staff.some(
    (member) => member.id !== target.id && member.role === "ADMIN" && !member.disabledAt,
  );

  if (!otherActiveAdmin && !target.disabledAt) {
    throw new InvalidInputError(
      `You can't ${what} the last active admin — nobody would be left to manage accounts. Make someone else an admin first.`,
    );
  }
}

/**
 * 24 characters from 18 random bytes. Well past the twelve-character minimum,
 * base64url so it survives being read aloud or pasted into a chat without an
 * ambiguous symbol, and never stored anywhere but as its hash.
 */
function generatePassword(): string {
  return randomBytes(18).toString("base64url");
}

function toStaffMember(row: StaffRow, viewer: AccessClaims): AdminStaffMember {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as AdminRole,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    disabledAt: row.disabledAt?.toISOString() ?? null,
    isSelf: row.id === viewer.sub,
  };
}

function auditContext(context: AdminUsersContext) {
  return {
    actor: { sub: context.actor.sub, email: context.actor.email },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  };
}
