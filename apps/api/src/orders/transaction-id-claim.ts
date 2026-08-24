import { and, eq, ne, notInArray } from "drizzle-orm";
import type { Executor } from "../db/db.types";
import { orders } from "../db/schema";
import { normaliseTransactionId } from "../payment-verification";
import type { OrderStatus } from "./order-status.machine";

/* --------------------------------------------------------------------------
   "Has this receipt already been spent?"

   A payment SMS is a single event: one transaction ID means one payment of
   one amount, once. Nothing before this module ever asked whether a receipt
   was already attached to another order, and every path that grants an order
   was happy to consume the same one repeatedly — the gateway lookup finds the
   still-present record, the amount check passes because the price is the
   same, and the payments table's idempotency key is the *order number*, so no
   constraint objects to the second grant. One payment, unlimited books.

   This is the missing question, asked as a query rather than as a unique
   index. A constraint could not do this job: it cannot compare
   case-insensitively, it cannot ignore orders whose claim has been released,
   and it cannot name the order that already holds the receipt — which is the
   single most useful thing to say, because the common cause of a repeated
   transaction ID is not fraud but a customer who thinks their first order
   failed.
   -------------------------------------------------------------------------- */

/**
 * Statuses whose hold on a receipt has been let go.
 *
 * A cancelled or refunded order has no outstanding claim on the money: the
 * shop either never took it or has sent it back, so the customer re-placing
 * the order with the same receipt is doing the right thing and must not be
 * blocked. Every other status — including PENDING — counts, because PENDING
 * is exactly the state a receipt is sitting in while it waits to be checked.
 */
export const RELEASED_STATUSES: OrderStatus[] = ["CANCELLED", "REFUNDED"];

/** The order that already holds a receipt, as much of it as a caller needs. */
export type TransactionIdClaim = {
  orderNumber: string;
  status: OrderStatus;
  createdAt: Date;
};

/**
 * The order already holding `transactionId`, or undefined if the receipt is
 * unspent.
 *
 * Matched against `orders.transaction_id_normalised`, the column Postgres
 * generates from whatever the customer typed. `PAY123`, `pay123`, `PAY 123`
 * and `PAY-123` are one receipt, and a check that compared raw text would be
 * defeated by pressing shift.
 *
 * This used to normalise per-row in the WHERE clause, which meant it could not
 * use an index and read as a full scan on the checkout path. Against a stored
 * generated column it is an index seek, and — more importantly — the value
 * being searched for is produced by the same expression that produced the
 * values being searched, so the two cannot disagree.
 *
 * Note this finds a claim regardless of whether the database would also refuse
 * it. `orders_transaction_id_live_unique_idx` is the backstop for the race
 * this query cannot win; this query is what turns a bare 23505 into a sentence
 * naming the order that already holds the receipt.
 *
 * @param excludeOrderId the order doing the asking, so an order does not
 *   report itself as the thief of its own receipt.
 */
export async function findTransactionIdClaim(
  executor: Executor,
  transactionId: string | null | undefined,
  options: { excludeOrderId?: string } = {},
): Promise<TransactionIdClaim | undefined> {
  const normalised = normaliseTransactionId(transactionId);

  // No receipt is not a reused receipt. Cash on delivery lands here, as does
  // any manual-transfer order placed before the field was collected.
  if (!normalised) return undefined;

  const [claim] = await executor
    .select({
      orderNumber: orders.orderNumber,
      status: orders.status,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(
      and(
        eq(orders.transactionIdNormalised, normalised),
        notInArray(orders.status, RELEASED_STATUSES),
        options.excludeOrderId ? ne(orders.id, options.excludeOrderId) : undefined,
      ),
    )
    // Oldest first: of two orders quoting one receipt, the first to claim it
    // is the one that owns it, and the one worth naming to whoever is looking
    // at the second.
    .orderBy(orders.createdAt)
    .limit(1);

  return claim;
}
