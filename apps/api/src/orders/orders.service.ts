import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import type { Order, OrderCancelRequest, OrderLookupRequest } from "@sakura/contracts";
import { and, eq, or, sql } from "drizzle-orm";
import { ResourceNotFoundError } from "../common/errors";
import { DbService } from "../db/db.service";
import type { Executor, Transaction } from "../db/db.types";
import { orders, orderStatusHistory } from "../db/schema";
import { InventoryService } from "../inventory";
import { toOrderResponse } from "./order.mapper";
import { findOrder, findOrders } from "./order.query";
import {
  STOCK_HELD_STATUSES,
  canTransition,
  forwardPathTo,
  releasesStock,
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
   * Guest order lookup: any one of order number, email, or phone.
   *
   * There are no accounts, and no order-ID-plus-email pairing either — a
   * customer who cannot find their confirmation email should still be able to
   * find their order. Order number, when given, is authoritative on its own
   * and returns that one order. Otherwise this matches on email and/or phone,
   * whichever were given, and returns every order either one touches — a
   * repeat customer has more than one.
   *
   * This is deliberately single-factor: knowing a customer's email or phone is
   * now enough to see their order history. `StrictThrottle` on the controller
   * is the mitigation, not a second required field. An empty result is the
   * only "not found" signal there is — it never distinguishes "no such order"
   * from "nothing matched that email/phone", for the same enumeration reason
   * the old two-factor design collapsed both into NOT_FOUND.
   */
  async lookup(request: OrderLookupRequest): Promise<Order[]> {
    if (request.orderNumber) {
      const order = await this.byNumber(request.orderNumber.trim().toUpperCase());
      return order ? [order] : [];
    }

    const conditions = [];

    if (request.email) {
      // lower() on both sides rather than citext or a stored normalised
      // column: the volume is one lookup per customer, and adding a column
      // would mean a second thing that can fall out of step with the address
      // the confirmation email was actually sent to.
      conditions.push(sql`lower(${orders.customerEmail}) = lower(${request.email.trim()})`);
    }

    if (request.phone) {
      // Neither checkout nor the schema normalises phone format, so "01711
      // 111111", "01711-111111" and "+8801711111111" are all real stored
      // values for the same number. Comparing on digits only is what makes
      // any of them find the order.
      conditions.push(
        sql`regexp_replace(${orders.customerPhone}, '[^0-9]', '', 'g') = regexp_replace(${request.phone.trim()}, '[^0-9]', '', 'g')`,
      );
    }

    // Unreachable via the controller — orderLookupRequestSchema requires at
    // least one field — but a bare `or()` with nothing to OR would compile to
    // no WHERE clause at all and return every order in the shop, so this stays
    // as the guard against that rather than trusting the caller.
    if (conditions.length === 0) return [];

    const rows = await findOrders(this.dbService.db, or(...conditions)!);

    return rows.map(toOrderResponse);
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
   *
   * **It also returns stock**, when the move is one that releases it — see
   * `releasesStock`. That lives here rather than in each caller because there
   * are now three of them (the guest cancel, the admin panel, a payment
   * reversal) and the failure mode of forgetting is silent: the order looks
   * correctly cancelled and the copies are simply gone from the shelf, with
   * nothing in any log to say so. Putting it behind the single write path for
   * `orders.status` makes "cancelled without restocking" a state this codebase
   * cannot express.
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

    if (releasesStock(current.status, next)) {
      await this.restoreStock(orderId, tx);
    }

    await tx.insert(orderStatusHistory).values({ orderId, status: next, note: note ?? null });

    return next;
  }

  /**
   * Put an order's copies back on the shelf.
   *
   * Private, and reachable only through `transition`, so stock cannot be
   * returned except as part of a status change that justifies it — the
   * inverse guarantee to the one InventoryService.increment's comment asks
   * for. Calling it twice for one order would invent inventory, and the only
   * caller is guarded by the same zero-rows check that serialises concurrent
   * transitions.
   */
  private async restoreStock(orderId: string, tx: Transaction): Promise<void> {
    const items = await tx.query.orderItems.findMany({
      where: (item, { eq: equals }) => equals(item.orderId, orderId),
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

      // Stock comes back inside `transition`, not here — see its comment. This
      // method used to do it by hand, which worked precisely as long as it was
      // the only way to cancel an order.
      await this.transition(locked.id, "CANCELLED", tx, request.reason ?? "Cancelled by customer");

      return locked.status;
    });

    // After commit, never inside: a listener acting on a rollback that has not
    // happened yet is the failure this ordering exists to prevent. The sales
    // rollup consumes exactly this event to un-count an order it had counted.
    this.emitStatusChange({ orderId: existing.id, orderNumber, from, to: "CANCELLED" });

    const order = await this.byNumber(orderNumber);
    if (!order) throw new ResourceNotFoundError("Order", orderNumber);

    return order;
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
   * Move an order to a status that is more than one step away, through every
   * status in between, in one transaction — then announce each step.
   *
   * The counterpart to `transitionAndCommit` for a caller whose action is
   * coarser than the lifecycle. Handing a parcel to the courier is one act at
   * the desk and two moves in the machine (PROCESSING, then SHIPPED), and the
   * route between them is computed by `forwardPathTo` rather than named by the
   * caller, so the panel never has to carry a second copy of the lifecycle.
   *
   * Every intermediate status is entered properly — `transition` runs for each
   * one, so each writes its own history row and each is checked against the
   * table. Nothing is skipped and nothing is faked: a customer's timeline
   * afterwards shows the order was picked and then dispatched, seconds apart,
   * which is what happened.
   *
   * One transaction for the whole walk, because a half-applied route is worse
   * than a refused one — an order stranded in PROCESSING with its parcel
   * already collected is invisible on every screen that would catch it.
   *
   * Events fire after commit, one per step and in order, for the reason
   * `transitionAndCommit` gives at length. Per step rather than one for the
   * whole jump because listeners key on *entering* a status — the sales rollup
   * counts on PAYMENT_CONFIRMED, the confirmation email sends on it — and a
   * single PAYMENT_CONFIRMED → SHIPPED event would silently skip both.
   */
  async advanceAndCommit(
    orderId: string,
    target: OrderStatus,
    note?: string,
  ): Promise<OrderStatus> {
    const { orderNumber, path, from } = await this.dbService.db.transaction(async (tx) => {
      const before = await tx.query.orders.findFirst({
        where: (row, { eq: equals }) => equals(row.id, orderId),
        columns: { status: true, orderNumber: true },
      });

      if (!before) throw new ResourceNotFoundError("Order", orderId);

      const route = forwardPathTo(before.status, target);

      // No route at all — a cancelled order asked to ship, or a delivered one
      // asked to go backwards. Reported as the illegal move the caller asked
      // for rather than as an empty walk that silently does nothing.
      if (!route) throw new InvalidStatusTransitionError(orderId, before.status, target);

      // The note goes on the step the caller actually asked for and on no
      // other. It is customer-visible on the tracking page, and "Marked
      // shipped" written against the picking step reads as a mistake — the
      // intermediate rows are there to carry a timestamp, not a claim.
      for (const next of route) {
        await this.transition(orderId, next, tx, next === target ? note : undefined);
      }

      return { orderNumber: before.orderNumber, path: route, from: before.status };
    });

    let previous = from;
    for (const status of path) {
      this.emitStatusChange({ orderId, orderNumber, from: previous, to: status });
      previous = status;
    }

    return target;
  }

  /**
   * Announce a status change committed by a caller that owned the transaction.
   *
   * The public counterpart to the private emitter below, for the one shape
   * `transitionAndCommit` cannot serve: a caller that has to write something
   * else in the *same* transaction as the transition — the admin refund, which
   * writes a payment row that must not commit without the status change that
   * explains it. Such a caller drives `transition` directly, so nothing emits
   * on its behalf.
   *
   * Named for what it is rather than exposing `emitStatusChange`, because the
   * contract is "you have already committed". Calling it before commit
   * reintroduces exactly the bug the emit-after-commit rule exists to prevent,
   * and a method called `announce` reads wrong at a call site where the commit
   * has not happened yet.
   */
  announceStatusChange(event: OrderStatusChangedEvent): void {
    this.emitStatusChange(event);
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
