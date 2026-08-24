import { Injectable, Logger } from "@nestjs/common";
import { desc, eq, and, type SQL } from "drizzle-orm";
import { DbService } from "../db/db.service";
import type { Transaction } from "../db/db.types";
import { auditLog } from "../db/schema";

export type AuditAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "LOGIN"
  | "LOGIN_FAILED"
  | "LOGOUT"
  | "TRANSITION"
  | "ADJUST"
  /**
   * A member of staff confirmed an order whose receipt was already on another
   * live order, giving a written reason.
   *
   * Its own action rather than an UPDATE with a telling note, because this is
   * the log line someone will go looking for — "show me every time the
   * duplicate-payment block was bypassed" should be a filter on this column,
   * not a text search through notes.
   */
  | "DUPLICATE_RECEIPT_OVERRIDE";

/**
 * Who acted.
 *
 * Structurally compatible with the admin token's claims rather than derived
 * from them, which is the point: the audit log moved out of AdminModule when a
 * machine gained the ability to accept money, and infrastructure that every
 * feature writes to must not depend on the shape of one feature's session
 * token. `sub` is an admin user's id where there is one — omit the actor
 * entirely for an automatic action, and see the `after` payload conventions in
 * pre-order-payment-verification.service.ts for how those identify themselves.
 */
export type AuditActor = { sub: string; email: string };

export type AuditEntry = {
  actor?: AuditActor;
  action: AuditAction;
  entityType: string;
  entityId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  note?: string;
  ipAddress?: string;
  userAgent?: string;
};

/**
 * Writes the audit trail.
 *
 * ## Why this takes a `Transaction`
 *
 * The entry and the change it describes must commit together, in both
 * directions. An entry written for a change that then rolled back is a record
 * of something that never happened; a change committed without its entry is
 * the exact gap the table exists to close. Every other guarantee in this
 * backend — one writer per column, provable history — becomes unverifiable the
 * moment the log is allowed to disagree with the data.
 *
 * That is also why there is no fire-and-forget variant and no event listener.
 * `units_sold` is rolled up asynchronously because it is a cache of a fact the
 * order tables already hold; an audit entry is the *only* record of who acted,
 * so it has nowhere to be reconstructed from.
 *
 * `record` therefore does not catch its own errors. If the log cannot be
 * written, the change does not happen.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly dbService: DbService) {}

  async record(entry: AuditEntry, tx: Transaction): Promise<void> {
    await tx.insert(auditLog).values({
      actorId: entry.actor?.sub ?? null,
      // Frozen alongside the id — see the column comment for why both.
      actorEmail: entry.actor?.email ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      note: entry.note ?? null,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent?.slice(0, 512) ?? null,
    });
  }

  /**
   * The escape hatch, for actions with no transaction to join: a failed login,
   * a logout. Those write nothing else, so there is nothing for the entry to
   * be atomic *with*, and refusing to log them would leave the security-
   * relevant half of the trail empty.
   *
   * This one does swallow its errors, and the asymmetry is the point: a
   * database blip must not turn a failed login into a 500, because a 500 on a
   * wrong password is itself an oracle — it distinguishes the request that hit
   * the logging path from one that did not.
   */
  async recordDetached(entry: AuditEntry): Promise<void> {
    try {
      await this.dbService.db.transaction((tx) => this.record(entry, tx));
    } catch (error) {
      this.logger.error(
        `Failed to write audit entry ${entry.action} ${entry.entityType}: ${String(error)}`,
      );
    }
  }

  /**
   * Read the trail. Newest first, always — an audit log read oldest-first is a
   * log nobody scrolls to the bottom of.
   */
  async list(
    filters: { entityType?: string; entityId?: string; actorId?: string } = {},
    pagination: { limit?: number; offset?: number } = {},
  ) {
    const conditions: SQL[] = [];

    if (filters.entityType) conditions.push(eq(auditLog.entityType, filters.entityType));
    if (filters.entityId) conditions.push(eq(auditLog.entityId, filters.entityId));
    if (filters.actorId) conditions.push(eq(auditLog.actorId, filters.actorId));

    return this.dbService.db
      .select()
      .from(auditLog)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(auditLog.createdAt))
      .limit(Math.min(pagination.limit ?? 50, 200))
      .offset(pagination.offset ?? 0);
  }
}
