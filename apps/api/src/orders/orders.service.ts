import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import type { Order, OrderCancelRequest, OrderLookupRequest } from "@sakura/contracts";
import { and, eq, sql } from "drizzle-orm";
import { ResourceNotFoundError } from "../common/errors";
import { DbService } from "../db/db.service";
import type { Executor, Transaction } from "../db/db.types";
import { orders, orderStatusHistory } from "../db/schema";
import { InventoryService } from "../inventory";
import { toOrderResponse } from "./order.mapper";
import { findOrder } from "./order.query";
import {
  STOCK_HELD_STATUSES,
  canTransition,
  type OrderStatus,
} from "./order-status.machine";
import { InvalidStatusTransitionError } from "./order.errors";
import { ORDER_STATUS_CHANGED } from "../common/events";
import type { OrderStatusChangedEvent } from "./order.events";

/**
 * Reading orders, and moving them through the lifecycle.
 *
 * Split from CheckoutService because the two have opposite shapes: checkout is
 * one long transaction that runs once per order, and this is everything that
 * happens to an order afterwards. Keeping them together would put the guest
 * lookup path inside the class that owns the money transaction.
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly inventoryService: InventoryService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Guest order lookup: order number *plus* a matching email.
   *
   * There are no accounts, so possession of both is the authentication. The
   * comparison is case-insensitive on the email because nobody remembers
   * whether they capitalised it, and order numbers are normalised upward
   * because they are read off a printed confirmation.
   *
   * **A mismatch returns NOT_FOUND, never 403.** This is the whole security
   * property of the endpoint: a "wrong email for that order" response confirms
   * the order number is real, which turns an eight-character number space into
   * an enumeration oracle for anyone willing to iterate it. The same answer
   * for "no such order" and "not your order" is what makes the number space
   * worth having. Throttling is the other half — see the controller.
   */
  async lookup(request: OrderLookupRequest): Promise<Order> {
    const orderNumber = request.orderNumber.trim().toUpperCase();

    const row = await findOrder(
      this.dbService.db,
      and(
        eq(orders.orderNumber, orderNumber),
        // lower() on both sides rather than citext or a stored normalised
        // column: the volume is one lookup per customer per order, and adding
        // a column would mean a second thing that can fall out of step with
        // the address the confirmation email was actually sent to.
        sql`lower(${orders.customerEmail}) = lower(${request.email.trim()})`,
      )!,
    );

    if (!row) {
      // Logged without the email, and at debug: a failed lookup is either a
      // typo or someone probing, and neither is worth an alert. The pair is
      // deliberately not recorded together — a log line holding both halves of
      // the credential would defeat the design above.
      this.logger.debug(`Order lookup miss for ${orderNumber}`);

      throw new ResourceNotFoundError("Order", orderNumber);
    }

    return toOrderResponse(row);
  }

  /**
   * Move an order to a new status, and log the move.
   *
   * The single write path for `orders.status`. No controller and no other
   * service may set that column: the append-only history is the source of
   * truth and the column is a read cache (§3.11), so the only way that stays
   * true is if updating one without the other is impossible to express.
   *
   * Takes a `Transaction`, not an `Executor`, and the reason is the same one
   * that governs coupon redemption: the status and its history row are one
   * fact written twice, and a caller that could pass the root db would be able
   * to commit half of it. Callers that just want to move a status open a
   * one-statement transaction — cheap, and it keeps the guarantee unconditional.
   *
   * The update is guarded on the status we believe the order is in, so two
   * concurrent transitions cannot both succeed: the loser matches zero rows
   * and gets the same refusal as an illegal transition.
   */
  async transition(
    orderId: string,
    next: OrderStatus,
    tx: Transaction,
    note?: string,
  ): Promise<OrderStatus> {
    const current = await tx.query.orders.findFirst({
      where: (row, { eq: equals }) => equals(row.id, orderId),
      columns: { status: true },
    });

    if (!current) throw new ResourceNotFoundError("Order", orderId);
    if (!canTransition(current.status, next)) {
      throw new InvalidStatusTransitionError(orderId, current.status, next);
    }

    const updated = await tx
      .update(orders)
      .set({ status: next })
      .where(and(eq(orders.id, orderId), eq(orders.status, current.status)))
      .returning({ id: orders.id });

    // Zero rows means someone else transitioned this order between the read
    // above and this update. Reported as an invalid transition from the status
    // we checked, because that is exactly what happened from this caller's
    // point of view, and the details carry what was allowed.
    if (updated.length === 0) {
      throw new InvalidStatusTransitionError(orderId, current.status, next);
    }

    await tx.insert(orderStatusHistory).values({ orderId, status: next, note: note ?? null });

    return next;
  }

  /**
   * Cancel an order and put its stock back.
   *
   * Authenticated the same way lookup is — order number plus a matching email,
   * NOT_FOUND on any mismatch — because there are no accounts and possession of
   * both is what stands in for one. Unlike lookup this writes, so the two
   * halves it performs have to be one atomic act: stock returned for an order
   * that then fails to reach CANCELLED is inventory invented from nothing, and
   * an order cancelled without returning stock is a copy nobody can buy.
   *
   * Refused once the parcel has shipped. That is not enforced here by an `if`
   * on the status name — it falls out of the machine, which lists CANCELLED as
   * reachable from exactly the three stock-held statuses. The explicit
   * STOCK_HELD_STATUSES check below is about the *stock*, not the transition,
   * and the two agreeing is the invariant that file's comment warns about.
   *
   * What is deliberately **not** undone: the coupon. `redeem()` incremented
   * `timesUsed` inside the checkout transaction, and cancelling does not give
   * it back — the lifecycle comment on CANCELLED says a cancelled order is
   * never resurrected precisely so that coupon and sales accounting stay
   * append-only. A customer who changes their mind places a new order; if the
   * code was single-use, that is a support conversation, not a silent
   * decrement racing every other redemption.
   */
  async cancel(request: OrderCancelRequest): Promise<Order> {
    const orderNumber = request.orderNumber.trim().toUpperCase();

    // Authenticate before opening a transaction. The lookup is the same query
    // and the same failure mode, so it is reused rather than re-expressed —
    // two implementations of "is this your order?" is one too many.
    const existing = await this.findByCredentials(orderNumber, request.email);

    if (!existing) {
      this.logger.debug(`Order cancel miss for ${orderNumber}`);

      throw new ResourceNotFoundError("Order", orderNumber);
    }

    const from = await this.dbService.db.transaction(async (tx) => {
      /**
       * Re-read inside the transaction, and lock the row.
       *
       * The status checked outside a transaction is a status that can move
       * before the write lands — an admin marking the order shipped in the
       * same second is the realistic case. `for("update")` makes the second
       * cancel attempt wait rather than read the stale value, so two clicks
       * cannot both restore stock.
       */
      const [locked] = await tx
        .select({ id: orders.id, status: orders.status })
        .from(orders)
        .where(eq(orders.id, existing.id))
        .for("update");

      if (!locked) throw new ResourceNotFoundError("Order", orderNumber);

      if (!STOCK_HELD_STATUSES.includes(locked.status)) {
        throw new InvalidStatusTransitionError(locked.id, locked.status, "CANCELLED");
      }

      const items = await tx.query.orderItems.findMany({
        where: (item, { eq: equals }) => equals(item.orderId, locked.id),
        columns: { bookId: true, quantity: true },
      });

      for (const item of items) {
        // A null bookId means the title was deleted outright rather than
        // delisted. There is no row to credit, and the order line keeps its
        // snapshot regardless — this is the one case where stock cannot be
        // returned, and it is silent because there is nothing to say.
        if (!item.bookId) continue;

        await this.inventoryService.increment(item.bookId, item.quantity, tx);
      }

      await this.transition(locked.id, "CANCELLED", tx, request.reason ?? "Cancelled by customer");

      return locked.status;
    });

    // After commit, never inside: a listener acting on a rollback that has not
    // happened yet is the failure this ordering exists to prevent. The sales
    // rollup consumes exactly this event to un-count an order it had counted.
    this.emitStatusChange({ orderId: existing.id, orderNumber, from, to: "CANCELLED" });

    return this.lookup({ orderNumber, email: request.email });
  }

  /**
   * Transition an order in its own transaction, then announce it.
   *
   * The entry point for callers that are not already inside one — a webhook
   * confirming payment, an admin moving an order along. `transition` itself
   * cannot emit: a listener firing inside the transaction would see, and act
   * on, a status that a later failure still rolls back. So the emit happens
   * strictly after commit, which is also why it is not awaited — the caller's
   * response must not wait on a rollup, and a listener that throws must not
   * turn a committed transition into a 500.
   *
   * The consequence, stated rather than hidden: an event can be lost if the
   * process dies between commit and emit. That is why `units_sold` is
   * documented as needing a reconciliation job — the rollup is an optimisation
   * over `order_items`, which is the actual record, so a lost event costs an
   * inaccurate sort order until reconciliation, not a lost sale.
   */
  async transitionAndCommit(
    orderId: string,
    next: OrderStatus,
    note?: string,
  ): Promise<OrderStatus> {
    const { from, orderNumber } = await this.dbService.db.transaction(async (tx) => {
      const before = await tx.query.orders.findFirst({
        where: (row, { eq: equals }) => equals(row.id, orderId),
        columns: { status: true, orderNumber: true },
      });

      if (!before) throw new ResourceNotFoundError("Order", orderId);

      await this.transition(orderId, next, tx, note);

      return { from: before.status, orderNumber: before.orderNumber };
    });

    this.emitStatusChange({ orderId, orderNumber, from, to: next });

    return next;
  }

  /**
   * Announce a committed status change.
   *
   * Not awaited, and that is the contract: the caller's response must not wait
   * on a listener, and a listener that throws must not turn a committed
   * transition into a 500. Every emitter goes through here so that "emit only
   * after commit" is one rule in one place rather than a convention each new
   * call site has to remember.
   */
  private emitStatusChange(event: OrderStatusChangedEvent): void {
    this.events.emit(ORDER_STATUS_CHANGED, event);
  }

  /** The order behind a number *and* a matching email, or nothing. */
  private async findByCredentials(
    orderNumber: string,
    email: string,
  ): Promise<{ id: string } | undefined> {
    return this.dbService.db.query.orders.findFirst({
      where: (row, { and: both, eq: equals }) =>
        both(
          equals(row.orderNumber, orderNumber),
          sql`lower(${row.customerEmail}) = lower(${email.trim()})`,
        ),
      columns: { id: true },
    });
  }

  /** The order behind a number, for callers that already have authority. */
  async byNumber(
    orderNumber: string,
    executor: Executor = this.dbService.db,
  ): Promise<Order | undefined> {
    const row = await findOrder(executor, eq(orders.orderNumber, orderNumber));

    return row ? toOrderResponse(row) : undefined;
  }
}
