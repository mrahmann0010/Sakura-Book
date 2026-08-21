import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import type { AdminLoginRequest, AdminRole, AdminUser } from "@sakura/contracts";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import type { Env } from "../../config/env.schema";
import { DbService } from "../../db/db.service";
import type { Executor, Transaction } from "../../db/db.types";
import { adminSessions, adminUsers } from "../../db/schema";
import { AccountLockedError, InvalidCredentialsError, SessionExpiredError } from "./auth.errors";
import { hashPassword, needsRehash, verifyPassword } from "./password";
import {
  accessClaimsSchema,
  hashRefreshToken,
  mintRefreshToken,
  type AccessClaims,
  type AccessClaimsInput,
} from "./tokens";

/** Where a sign-in came from, for the session list and the audit trail. */
export type RequestContext = {
  ipAddress?: string;
  userAgent?: string;
};

/** A freshly issued pair, for the controller to set as cookies. */
export type IssuedSession = {
  user: AdminUser;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
};

/**
 * Sign-in, refresh, sign-out, and the verification the guard depends on.
 *
 * ## The session model
 *
 * Two credentials with opposite trade-offs, paired so each covers the other's
 * weakness.
 *
 * The **access token** is a signed JWT with a fifteen-minute life. It is
 * verified with a signature check and no database round-trip, which is what
 * keeps a guard on every admin route from putting a SELECT in front of every
 * request. Its weakness is that a stateless credential cannot be taken back.
 *
 * The **refresh token** is 32 opaque random bytes that exist as a row in
 * `admin_sessions`. It has no meaning without that row, so deleting the row
 * revokes it instantly. Its weakness is that using it costs a query.
 *
 * The pairing: a stolen access token is useless in fifteen minutes, and a
 * stolen refresh token is useless the moment anyone notices, because rotation
 * makes *using* it detectable.
 *
 * ## Why not just sessions in a table, and no JWT at all?
 *
 * Because the JWT is not buying performance here, it is buying a property: the
 * guard is a pure function of the request. Nothing in the authorisation path
 * can fail because the database is briefly unreachable, and nothing in it can
 * be made slow by a cold pool. That said, the honest cost is a revocation
 * window, and `sessions_valid_from` is how it is closed — see `verifyAccess`.
 */
@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly config: ConfigService<Env, true>,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Verify an email and password, and issue a session.
   *
   * The shape of this method is dictated by what it must *not* reveal. A login
   * endpoint answers a question an attacker wants answered — "is this an
   * account?" — and it can answer it three ways: through the error it returns,
   * through the time it takes, and through what it writes. The first is
   * handled in auth.errors.ts; the other two are handled here.
   */
  async login(request: AdminLoginRequest, context: RequestContext = {}): Promise<IssuedSession> {
    const user = await this.dbService.db.query.adminUsers.findFirst({
      where: eq(adminUsers.email, request.email),
    });

    /**
     * No such account. The hash is still computed against a throwaway value
     * before refusing, and that is not superstition: without it, a missing
     * account returns in ~1ms and a real one in ~100ms, so the response time
     * alone enumerates the staff list — over the network, at scale, from the
     * outside. The dummy verification makes both paths pay the same scrypt
     * cost.
     */
    if (!user) {
      await verifyPassword(request.password, DUMMY_HASH);
      throw new InvalidCredentialsError();
    }

    /**
     * A disabled account is refused with the same error as a wrong password,
     * so a departed employee cannot learn that their password was still
     * correct. Checked *before* the lockout, so a disabled account never
     * reports a countdown either.
     */
    if (user.disabledAt) {
      await verifyPassword(request.password, DUMMY_HASH);
      throw new InvalidCredentialsError();
    }

    const now = new Date();

    if (user.lockedUntil && user.lockedUntil > now) {
      throw new AccountLockedError(
        Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 1000),
      );
    }

    const valid = await verifyPassword(request.password, user.passwordHash);

    if (!valid) {
      await this.recordFailure(user.id);
      throw new InvalidCredentialsError();
    }

    /**
     * Correct password, but the parameters are stale. Re-hashed here because
     * this is the only moment the plaintext exists — see `needsRehash`. It is
     * deliberately not awaited inside the session transaction below: a slow
     * KDF must not hold a transaction open, and a failure to upgrade a hash is
     * not a reason to fail a valid login.
     */
    if (needsRehash(user.passwordHash)) {
      void this.upgradeHash(user.id, request.password);
    }

    return this.dbService.db.transaction(async (tx) => {
      await tx
        .update(adminUsers)
        .set({ failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: now })
        .where(eq(adminUsers.id, user.id));

      return this.issue({ ...user, lastLoginAt: now }, undefined, context, tx);
    });
  }

  /**
   * Exchange a refresh token for a new pair, and burn the old one.
   *
   * ## Rotation, and why the old row is kept
   *
   * Every refresh spends its token and issues a new one, so a token presented
   * twice is a token that was copied. That is the only signal available that a
   * refresh token leaked — nothing else about a stolen bearer credential looks
   * different from legitimate use — and it only exists because the spent row
   * is marked rather than deleted.
   *
   * When it fires, the whole chain is revoked, not just the replayed row. By
   * the time a replay is observed there are two holders and one of them has
   * already rotated forward; killing only what was replayed would sign out the
   * victim and leave the thief with a live token. Revoking the family signs
   * out both, which is the correct outcome: the legitimate user logs in again
   * with a password the thief does not have.
   */
  async refresh(token: string | undefined, context: RequestContext = {}): Promise<IssuedSession> {
    if (!token) throw new SessionExpiredError();

    const tokenHash = hashRefreshToken(token);

    return this.dbService.db.transaction(async (tx) => {
      const session = await tx.query.adminSessions.findFirst({
        where: eq(adminSessions.tokenHash, tokenHash),
        with: { user: true },
      });

      if (!session) throw new SessionExpiredError();

      if (session.revokedAt) {
        await this.revokeFamily(session.id, tx);

        this.logger.error(
          `Refresh token reuse detected for admin ${session.adminUserId}; session family revoked`,
        );

        throw new SessionExpiredError();
      }

      if (session.expiresAt <= new Date()) throw new SessionExpiredError();

      // Re-checked on every refresh rather than trusted from login, because a
      // thirty-day token outlives most personnel changes. This is the point at
      // which a disabled account actually stops working.
      if (session.user.disabledAt) throw new SessionExpiredError();

      await tx
        .update(adminSessions)
        .set({ revokedAt: new Date() })
        .where(eq(adminSessions.id, session.id));

      return this.issue(session.user, session.id, context, tx);
    });
  }

  /**
   * Sign out one device.
   *
   * Revokes the presented refresh token and nothing else — a staff member
   * signing out on the shop counter should stay signed in on their phone.
   * Silent on an unknown token: sign-out is not a place to report that a
   * credential was already invalid, and the client's next move is identical
   * either way.
   *
   * The access token is not revoked and cannot be; it stays valid for up to
   * its remaining life. The controller clears both cookies, which handles the
   * only case that matters in practice (the browser no longer has it). For the
   * case that does not — a token already copied elsewhere — `signOutEverywhere`
   * is the answer, and it is what a password change triggers.
   */
  async logout(token: string | undefined): Promise<void> {
    if (!token) return;

    await this.dbService.db
      .update(adminSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(adminSessions.tokenHash, hashRefreshToken(token)), isNull(adminSessions.revokedAt)));
  }

  /**
   * Invalidate every credential a user holds, of both kinds, immediately.
   *
   * Two writes because there are two kinds. Deleting the session rows kills
   * the refresh tokens; moving `sessionsValidFrom` to now kills the access
   * tokens, because `verifyAccess` refuses any token issued before it. This is
   * the only mechanism in the design that revokes a JWT, and it is why the
   * fifteen-minute window in the class comment is a bound on *unnoticed*
   * compromise rather than on response time.
   *
   * Called on password change, role change, and disable — the three events
   * after which an outstanding token means something different from what it
   * meant when it was signed.
   */
  async signOutEverywhere(adminUserId: string, tx: Transaction): Promise<void> {
    await tx
      .update(adminUsers)
      .set({ sessionsValidFrom: new Date() })
      .where(eq(adminUsers.id, adminUserId));

    await tx.delete(adminSessions).where(eq(adminSessions.adminUserId, adminUserId));
  }

  /**
   * Verify an access token. The guard's entire job, minus the plumbing.
   *
   * Two checks, and the second is the one that is easy to leave out. The
   * signature proves we issued the token and that it has not expired. It does
   * *not* prove the token still reflects reality — the account may have been
   * disabled, demoted, or had its password changed one minute ago, and a
   * signed claim knows nothing about any of that.
   *
   * So the token's `iat` is compared against `sessions_valid_from`, which every
   * revoking action bumps. That is one indexed primary-key read, which the
   * class comment's "no database round-trip" claim would seem to forbid —
   * except that being able to sack someone and have it take effect on their
   * next request is worth more than saving a sub-millisecond lookup on a route
   * a dozen people use. The JWT still earns its place: without it this would be
   * a lookup *plus* a session join plus an expiry check.
   */
  async verifyAccess(token: string): Promise<AccessClaims> {
    let claims: AccessClaims;

    try {
      claims = accessClaimsSchema.parse(await this.jwt.verifyAsync(token));
    } catch {
      // Bad signature, expired, or a payload shape we no longer recognise.
      // All three mean the same thing to the caller.
      throw new SessionExpiredError();
    }

    const user = await this.dbService.db.query.adminUsers.findFirst({
      where: eq(adminUsers.id, claims.sub),
      columns: { id: true, role: true, disabledAt: true, sessionsValidFrom: true },
    });

    if (!user || user.disabledAt) throw new SessionExpiredError();

    // `iat` is whole seconds; the column is microsecond-precise. Comparing
    // without flooring the column would reject a token issued in the same
    // second as the bump — which is exactly what happens when a user changes
    // their own password and is immediately re-issued a session.
    if (claims.iat * 1000 < Math.floor(user.sessionsValidFrom.getTime() / 1000) * 1000) {
      throw new SessionExpiredError();
    }

    // The role travels in the token for speed but is authoritative in the
    // table. A demotion must not wait for the token to expire, and taking the
    // claim on trust here would mean it did.
    return { ...claims, role: user.role as AdminRole };
  }

  /** The `/auth/me` payload, read fresh rather than reconstructed from claims. */
  async findById(id: string, executor: Executor = this.dbService.db): Promise<AdminUser | undefined> {
    const row = await executor.query.adminUsers.findFirst({ where: eq(adminUsers.id, id) });

    return row ? toAdminUser(row) : undefined;
  }

  /**
   * Delete spent and expired session rows.
   *
   * Not a cascade or a trigger, because the rows have to outlive their own
   * expiry by a margin: reuse detection reads revoked rows, so sweeping one
   * the moment it is spent would delete the evidence it exists to preserve.
   * The grace period is the window in which a replay is still recognisable
   * rather than merely unknown.
   */
  async pruneSessions(gracePeriodSeconds = 86400): Promise<number> {
    const cutoff = new Date(Date.now() - gracePeriodSeconds * 1000);

    const deleted = await this.dbService.db
      .delete(adminSessions)
      .where(lt(adminSessions.expiresAt, cutoff))
      .returning({ id: adminSessions.id });

    return deleted.length;
  }

  /**
   * Mint a pair and persist the refresh half.
   *
   * `Transaction`, not `Executor`, and for the standard reason from
   * db.types.ts: the session row and the user update that accompanies it —
   * clearing the lockout on login, revoking the predecessor on refresh — are
   * only correct together. A session written for a login that then failed to
   * clear its failed-attempt counter is a live credential on an account that
   * still believes it is under attack.
   */
  private async issue(
    user: AdminUserRow,
    rotatedFromId: string | undefined,
    context: RequestContext,
    tx: Transaction,
  ): Promise<IssuedSession> {
    const refreshTtl = this.config.get("ADMIN_REFRESH_TOKEN_TTL", { infer: true });
    const accessTtl = this.config.get("ADMIN_ACCESS_TOKEN_TTL", { infer: true });

    const refreshToken = mintRefreshToken();
    const refreshExpiresAt = new Date(Date.now() + refreshTtl * 1000);

    const [session] = await tx
      .insert(adminSessions)
      .values({
        adminUserId: user.id,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt: refreshExpiresAt,
        rotatedFromId: rotatedFromId ?? null,
        // Truncated: a User-Agent is attacker-controlled and unbounded, and
        // this column is only ever rendered as a device label.
        userAgent: context.userAgent?.slice(0, 512) ?? null,
        ipAddress: context.ipAddress ?? null,
      })
      .returning({ id: adminSessions.id });

    const claims: AccessClaimsInput = {
      sub: user.id,
      sid: session.id,
      role: user.role as AdminRole,
      email: user.email,
    };

    return {
      user: toAdminUser(user),
      accessToken: await this.jwt.signAsync(claims, { expiresIn: accessTtl }),
      refreshToken,
      accessExpiresAt: new Date(Date.now() + accessTtl * 1000),
      refreshExpiresAt,
    };
  }

  /**
   * Count a failed attempt, and lock the account if it crosses the threshold.
   *
   * The increment happens in the database (`attempts + 1`) rather than being
   * read into JS and written back, so concurrent attempts on the same account
   * cannot lose each other's counts — which is the whole attack this defends
   * against, and a read-modify-write here would let a parallel guesser get
   * unlimited tries with a counter permanently stuck at 1.
   *
   * The lockout is set in the same statement with a CASE, so there is no
   * window between counting the failure and acting on it.
   */
  private async recordFailure(adminUserId: string): Promise<void> {
    const maxAttempts = this.config.get("ADMIN_MAX_FAILED_LOGINS", { infer: true });
    const lockoutSeconds = this.config.get("ADMIN_LOCKOUT_SECONDS", { infer: true });

    await this.dbService.db
      .update(adminUsers)
      .set({
        failedLoginAttempts: sql`${adminUsers.failedLoginAttempts} + 1`,
        lockedUntil: sql`
          case when ${adminUsers.failedLoginAttempts} + 1 >= ${maxAttempts}
            then now() + ${`${lockoutSeconds} seconds`}::interval
            else ${adminUsers.lockedUntil}
          end`,
      })
      .where(eq(adminUsers.id, adminUserId));
  }

  /**
   * Replace a stale hash after a successful login. Fire-and-forget: the login
   * has already succeeded and must not be failed by a housekeeping write.
   */
  private async upgradeHash(adminUserId: string, password: string): Promise<void> {
    try {
      await this.dbService.db
        .update(adminUsers)
        .set({ passwordHash: await hashPassword(password) })
        .where(eq(adminUsers.id, adminUserId));
    } catch (error) {
      this.logger.warn(`Failed to upgrade password hash for ${adminUserId}: ${String(error)}`);
    }
  }

  /**
   * Walk a rotation chain to its root and revoke every link.
   *
   * Recursive CTE rather than a loop in JS, because the chain has to be
   * traversed in both directions from an arbitrary point — the replayed token
   * may be anywhere in it — and doing that with round-trips would be one query
   * per link with a race in every gap.
   */
  private async revokeFamily(sessionId: string, tx: Transaction): Promise<void> {
    await tx.execute(sql`
      with recursive family as (
        select id, rotated_from_id from admin_sessions where id = ${sessionId}
        union
        select s.id, s.rotated_from_id
        from admin_sessions s
        join family f on s.rotated_from_id = f.id or s.id = f.rotated_from_id
      )
      update admin_sessions
      set revoked_at = now()
      where id in (select id from family) and revoked_at is null
    `);
  }
}

type AdminUserRow = typeof adminUsers.$inferSelect;

/**
 * Row → wire shape. Every field not listed is dropped, and the omission is the
 * function's purpose: `passwordHash`, `failedLoginAttempts`, `lockedUntil` and
 * `sessionsValidFrom` are all inputs to server-side decisions, and a client
 * that could see them could probe them.
 */
function toAdminUser(row: AdminUserRow): AdminUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role as AdminRole,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * A real hash of a value nobody knows, used to spend scrypt time on the
 * "no such account" path. Computed once at module load rather than per
 * request, because computing it per request would itself be the timing
 * difference it exists to erase.
 */
const DUMMY_HASH =
  "scrypt$65536$8$1$" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=$" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";
