import { Injectable, Logger } from "@nestjs/common";
import { normaliseTrxId, type ClaimOutcome } from "@project-sakura/pay";
import type { AdminOrderVerificationState, PaymentVerificationRecord } from "@sakura/contracts";
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { orders, paymentVerifications } from "../db/schema";
import { RELEASED_STATUSES } from "./transaction-id-claim";

/* --------------------------------------------------------------------------
   The written record of every payment check — today, every gateway claim.

   The gateway client (@project-sakura/pay) answers one question — "may this
   order spend this payment?" — and knows nothing about orders. Storing an
   answer *against an order* is our concern, so it lives here, as does turning
   the package's outcome into a row.

   Append-only, and best-effort by design; see `recordClaim`. Rows from before
   claims (MATCHED, NOT_FOUND) are still read back for the history.
   -------------------------------------------------------------------------- */

/**
 * Flatten a claim for the log: what we concluded, when, and enough of the
 * evidence to explain it later without asking the gateway again — which is
 * not possible anyway, since it has no read endpoint. The package says
 * poisha; the log says cents. Same number, only the names differ.
 *
 * Exported for tests only; callers go through `recordClaim`.
 */
export function toClaimRecord(
  outcome: ClaimOutcome,
  context: { transactionId: string; expectedCents: number; claimKey: string },
): PaymentVerificationRecord {
  const base = {
    outcome: outcome.outcome,
    checkedAt: new Date().toISOString(),
    transactionId: context.transactionId,
    expectedCents: context.expectedCents,
    claimKey: context.claimKey,
  };

  switch (outcome.outcome) {
    case "CLAIMED":
      return {
        ...base,
        provider: outcome.platform,
        paidCents: outcome.paidPoisha,
        overpaidCents: outcome.overpaidPoisha,
        claimedAt: outcome.claimedAt.toISOString(),
      };
    case "UNDERPAID":
      return { ...base, paidCents: outcome.paidPoisha ?? undefined };
    case "ALREADY_CLAIMED":
      return { ...base, claimedAt: outcome.claimedAt?.toISOString() };
    case "REJECTED":
    case "MISCONFIGURED":
    case "UNAVAILABLE":
      return { ...base, reason: outcome.reason };
    case "PENDING_ARRIVAL":
    case "RELEASED":
      return base;
  }
}

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
   * Append one gateway claim to an order's history.
   *
   * Failures are logged and swallowed. This is a record *about* an action,
   * not the action: the claim has already happened at the gateway, and the
   * caller must still act on it — a customer's checkout must complete, and
   * staff must still be told what the gateway said. The alternative is a
   * logging table whose outage takes down the thing it is logging.
   *
   * @param checkedByEmail the staff member who asked, or null for the
   *   automatic claim at checkout and the background retries.
   */
  async recordClaim(
    orderId: string,
    outcome: ClaimOutcome,
    context: { transactionId: string; expectedCents: number; claimKey: string },
    checkedByEmail: string | null,
  ): Promise<PaymentVerificationRecord> {
    const record = toClaimRecord(outcome, context);

    try {
      await this.dbService.db.insert(paymentVerifications).values({
        orderId,
        outcome: record.outcome,
        transactionIdNormalised: normaliseTrxId(record.transactionId),
        provider: record.provider,
        paidCents: record.paidCents,
        expectedCents: record.expectedCents,
        reason: record.reason,
        claimKey: record.claimKey,
        claimedAt: record.claimedAt ? new Date(record.claimedAt) : null,
        checkedByEmail,
        raw: outcome,
      });
    } catch (error) {
      this.logger.error(
        `Could not record the ${record.outcome} claim for order ${orderId}: ${String(error)}`,
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
      overpaidCents: overpaidCentsOf(row),
      claimedAt: row.claimedAt?.toISOString(),
      claimKey: row.claimKey ?? undefined,
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

/** How much more than the total arrived on a claim, if anything. */
function overpaidCentsOf(row: {
  outcome: string;
  paidCents: number | null;
  expectedCents: number | null;
}): number | undefined {
  if (row.outcome !== "CLAIMED" || row.paidCents === null || row.expectedCents === null) {
    return undefined;
  }

  return Math.max(0, row.paidCents - row.expectedCents);
}
