import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { eq, sql } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { books, orderItems } from "../db/schema";
import { ORDER_STATUS_CHANGED } from "../common/events";
// Type-only, and that is load-bearing: a value import of the orders barrel
// here would close a cycle with OrdersModule, which imports this module.
import type { OrderStatusChangedEvent } from "../orders";

/**
 * Keeps `books.units_sold` roughly true, after the fact.
 *
 * The column's own schema comment sets the rule this implements: increment
 * asynchronously when an order reaches PAYMENT_CONFIRMED, never inline in
 * checkout. The reason is that `units_sold` is a denormalisation whose only
 * consumers are a sort order and a shop-floor curiosity, and putting its write
 * inside the checkout transaction would add row contention on the shop's most
 * popular titles — the exact rows every concurrent checkout is already
 * competing for — to protect a number nobody is charged for.
 *
 * The source of truth is `order_items` joined to orders in a confirmed status.
 * This is a cache over that, so drift is a correctness question about a sort
 * order, not about money, and the documented fix is a reconciliation job that
 * recomputes from the join.
 */
@Injectable()
export class SalesRollupListener {
  private readonly logger = new Logger(SalesRollupListener.name);

  constructor(private readonly dbService: DbService) {}

  /**
   * Fires on every status change and acts on two.
   *
   * Filtered here rather than by subscribing to narrower events, because the
   * transition emitter must not have to know which statuses anyone cares about.
   *
   * **Entering PAYMENT_CONFIRMED counts the sale. Cancelling afterwards
   * un-counts it.** The second half is not symmetry for its own sake: the
   * machine allows CANCELLED from PAYMENT_CONFIRMED and PROCESSING, so without
   * it a shop that confirms and then cancels an order keeps the units on the
   * books forever, and `units_sold` drifts upward — in the one direction that
   * makes a title look like a bestseller because it kept falling through.
   *
   * `from` is what decides whether there is anything to reverse. An order
   * cancelled straight out of PENDING was never counted, and subtracting there
   * would push the number negative.
   *
   * REFUNDED deliberately does not reverse. A refunded order was delivered —
   * the book left the building and the sale happened; what came back is money,
   * which is not what this column measures. Returns handling is out of scope
   * (§2), and if it arrives it brings its own restocking decision.
   *
   * Errors are swallowed after logging. A listener runs after its transaction
   * committed, and there is nothing left to roll back — throwing would only
   * produce an unhandled rejection, while the order is already confirmed.
   */
  @OnEvent(ORDER_STATUS_CHANGED)
  async onStatusChanged(event: OrderStatusChangedEvent): Promise<void> {
    const direction = directionFor(event);

    if (direction === 0) return;

    try {
      await this.rollUp(event.orderId, direction);
    } catch (error) {
      this.logger.error(
        `units_sold rollup failed for order ${event.orderNumber}; reconciliation will correct it`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * One UPDATE ... FROM, not a read followed by N writes.
   *
   * The arithmetic happens in the database so that two orders confirming at
   * once cannot lose an increment to a read-modify-write race — the same
   * reason InventoryService.increment is written this way. A deleted book is
   * simply not joined and contributes nothing, which is why there is no
   * not-found path here.
   *
   * `direction` is +1 to count a sale and -1 to reverse one, so both paths are
   * the same statement. `greatest(…, 0)` floors the result: the rollup is a
   * cache over `order_items` and an event can be lost between commit and emit,
   * so a reversal can arrive for units that were never added. Clamping keeps
   * the visible number merely stale rather than nonsensical — reconciliation
   * is what makes it right.
   */
  private async rollUp(orderId: string, direction: 1 | -1): Promise<void> {
    const sold = this.dbService.db
      .select({
        bookId: orderItems.bookId,
        quantity: sql<number>`sum(${orderItems.quantity})::int`.as("quantity"),
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId))
      .groupBy(orderItems.bookId)
      .as("sold");

    await this.dbService.db
      .update(books)
      .set({ unitsSold: sql`greatest(${books.unitsSold} + (${direction} * ${sold.quantity}), 0)` })
      .from(sold)
      .where(eq(books.id, sold.bookId));
  }
}

/**
 * +1 to count the sale, -1 to reverse it, 0 to ignore the event.
 *
 * A free function rather than a method because it is the whole rule and it is
 * pure — which is what lets the unit tests pin "cancelled from PENDING changes
 * nothing" without a database anywhere near it.
 */
export function directionFor(event: OrderStatusChangedEvent): 1 | -1 | 0 {
  if (event.to === "PAYMENT_CONFIRMED") return 1;

  // Only a cancellation of an order that had already been counted. The counted
  // statuses are exactly those at or past PAYMENT_CONFIRMED that can still
  // reach CANCELLED — read off the transition map, not guessed.
  if (event.to === "CANCELLED" && COUNTED_STATUSES.includes(event.from)) return -1;

  /* A confirmation withdrawn. The only backward edge in the machine, and it
     has to be un-counted here or `units_sold` ratchets upward every time a
     mistaken acceptance is corrected — the order goes back to PENDING and is
     later confirmed for real, counting the same copies twice.

     Written as its own clause rather than folded into the one above, because
     the rule there is "a cancellation of something already counted" and this
     is not a cancellation. `from` is pinned to PAYMENT_CONFIRMED rather than
     tested against COUNTED_STATUSES for the same care: PENDING is reachable
     from nowhere else, and if that ever changes this should stop matching
     until someone has thought about it. */
  if (event.to === "PENDING" && event.from === "PAYMENT_CONFIRMED") return -1;

  return 0;
}

/** Statuses an order can only be in if the rollup already counted it. */
const COUNTED_STATUSES: readonly OrderStatusChangedEvent["from"][] = Object.freeze([
  "PAYMENT_CONFIRMED",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
]);
