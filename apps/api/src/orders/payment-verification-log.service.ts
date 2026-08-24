import { Injectable, Logger } from "@nestjs/common";
import type { AdminOrderVerificationState, PaymentVerificationRecord } from "@sakura/contracts";
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { orders, paymentVerifications } from "../db/schema";
import {
  normaliseTransactionId,
  toVerificationRecord,
  type PaymentVerification,
} from "../payment-verification";
import { RELEASED_STATUSES } from "./transaction-id-claim";

/* --------------------------------------------------------------------------
   The written record of every gateway cross-check.

   This lives in `orders` rather than in `payment-verification` on purpose.
   That module answers one question — "did ৳X arrive under this transaction
   ID?" — about a MongoDB it does not own, and it deliberately knows nothing
   about orders. Storing an answer *against an order* is the caller's concern,
   so it belongs on this side of the boundary.

   Writing is best-effort by design; see `record`.
   -------------------------------------------------------------------------- */

/** An order that has never been checked. The panel's most important state. */
const UNCHECKED: AdminOrderVerificationState = {
  outcome: "UNCHECKED",
  checkedAt: null,
  checkedByEmail: null,
};

@Injectable()
export class PaymentVerificationLogService {
  private readonly logger = new Logger(PaymentVerificationLogService.name);

  constructor(private readonly dbService: DbService) {}

  /**
   * Append one check to an order's history.
   *
   * Failures are logged and swallowed. This is a record *about* an action, not
   * the action — an admin who pressed Verify must still be told what the
   * gateway said, and a customer's checkout must still complete, even if this
   * insert fails. The alternative is a logging table whose outage takes down
   * the thing it is logging.
   *
   * @param checkedByEmail the staff member who asked, or null for the
   *   automatic check at checkout — the distinction the history is read for.
   */
  async record(
    orderId: string,
    verification: PaymentVerification,
    expectedCents: number,
    checkedByEmail: string | null,
  ): Promise<PaymentVerificationRecord> {
    const record = toVerificationRecord(verification, expectedCents);

    try {
      await this.dbService.db.insert(paymentVerifications).values({
        orderId,
        outcome: record.outcome,
        transactionIdNormalised: normaliseTransactionId(record.transactionId),
        provider: record.provider,
        paidCents: record.paidCents,
        expectedCents: record.expectedCents,
        receivedAt: record.receivedAt ? new Date(record.receivedAt) : null,
        reason: record.reason,
        checkedByEmail,
        raw: verification,
      });
    } catch (error) {
      this.logger.error(
        `Could not record the ${record.outcome} verification for order ${orderId}: ${String(error)}`,
      );
    }

    return record;
  }

  /**
   * The latest check for each of many orders, in one query.
   *
   * `DISTINCT ON` rather than a lateral join or — worse — one query per row:
   * the queue renders twenty-five orders and a per-row lookup would make the
   * badge cost twenty-five round trips, which is how an indicator meant to
   * make the list safer instead makes it too slow to use.
   *
   * Orders with no row are simply absent from the map; callers read that as
   * UNCHECKED via `stateOf`.
   */
  async latestFor(orderIds: string[]): Promise<Map<string, AdminOrderVerificationState>> {
    if (orderIds.length === 0) return new Map();

    const rows = await this.dbService.db
      .selectDistinctOn([paymentVerifications.orderId], {
        orderId: paymentVerifications.orderId,
        outcome: paymentVerifications.outcome,
        checkedAt: paymentVerifications.createdAt,
        checkedByEmail: paymentVerifications.checkedByEmail,
      })
      .from(paymentVerifications)
      .where(inArray(paymentVerifications.orderId, orderIds))
      // The DISTINCT ON expression must lead the sort; the descending
      // timestamp after it is what makes "the row kept" mean "the newest".
      .orderBy(paymentVerifications.orderId, desc(paymentVerifications.createdAt));

    return new Map(
      rows.map((row) => [
        row.orderId,
        {
          outcome: row.outcome,
          checkedAt: row.checkedAt.toISOString(),
          checkedByEmail: row.checkedByEmail,
        },
      ]),
    );
  }

  /** One order's whole history, newest first. */
  async historyFor(orderId: string): Promise<PaymentVerificationRecord[]> {
    const rows = await this.dbService.db
      .select()
      .from(paymentVerifications)
      .where(eq(paymentVerifications.orderId, orderId))
      .orderBy(desc(paymentVerifications.createdAt))
      // A bound, not a page. Nothing sensible produces hundreds of checks
      // against one order, and if something does, the detail page is not where
      // that should first be discovered.
      .limit(50);

    return rows.map((row) => ({
      outcome: row.outcome,
      checkedAt: row.createdAt.toISOString(),
      transactionId: row.transactionIdNormalised,
      provider: row.provider ?? undefined,
      paidCents: row.paidCents ?? undefined,
      expectedCents: row.expectedCents ?? undefined,
      receivedAt: row.receivedAt?.toISOString(),
      reason: row.reason ?? undefined,
    }));
  }

  /**
   * Which of these receipts are held by more than one live order.
   *
   * One grouped query for a whole page, restricted to the receipts actually on
   * it. The alternative — calling `findTransactionIdClaim` once per row — is
   * twenty-five round trips to render one table, which is how an indicator
   * meant to make the queue safer instead makes it too slow to keep.
   *
   * Returns the duplicated receipts rather than the orders holding them: the
   * caller already has its page of rows and only needs to know which to mark.
   * Naming the *other* order is the detail view's job, where one lookup is
   * affordable and the name is worth having.
   */
  async findDuplicatedReceipts(normalisedReceipts: string[]): Promise<Set<string>> {
    const wanted = [...new Set(normalisedReceipts.filter(Boolean))];
    if (wanted.length === 0) return new Set();

    const rows = await this.dbService.db
      .select({ receipt: orders.transactionIdNormalised })
      .from(orders)
      .where(
        and(
          inArray(orders.transactionIdNormalised, wanted),
          notInArray(orders.status, RELEASED_STATUSES),
        ),
      )
      .groupBy(orders.transactionIdNormalised)
      .having(sql`count(*) > 1`);

    return new Set(rows.flatMap((row) => (row.receipt ? [row.receipt] : [])));
  }

  /** How every caller turns a possibly-absent entry into a state. */
  static stateOf(
    latest: Map<string, AdminOrderVerificationState>,
    orderId: string,
  ): AdminOrderVerificationState {
    return latest.get(orderId) ?? UNCHECKED;
  }
}
