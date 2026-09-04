import { orderStatusEnum } from "../db/schema";

export type OrderStatus = (typeof orderStatusEnum.enumValues)[number];

/**
 * Which status may follow which.
 *
 * A data structure rather than a scattering of `if`s, because the same rule
 * ("you cannot cancel a shipped order") has to hold for the admin endpoint, a
 * payment webhook, and a future reconciliation job. One table means one place
 * to read the lifecycle off, and one place to change it.
 *
 * The shape is a total Record over OrderStatus, not a partial one: adding a
 * status to the pgEnum then becomes a type error here until its outgoing
 * transitions are declared, instead of silently defaulting to "no transitions
 * allowed" and stranding every order that reaches it.
 */
export const ORDER_STATUS_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> =
  Object.freeze({
    // Manual payment methods mean an order can sit here for days. Cancellable
    // by either side while it does.
    PENDING: ["PAYMENT_CONFIRMED", "CANCELLED"],

    /* COD confirms on delivery, not before, so this is reachable from PENDING
       by a webhook or by an admin marking a bank transfer received.

       PENDING is the one backward edge in the table, and it exists for exactly
       one action: an admin undoing a confirmation they made by mistake. Before
       it, the only ways out of a wrongly-confirmed order were to cancel it —
       terminal, so the customer loses their order and their place — or to
       record a refund for money that never arrived. Both lie about what
       happened; this one says it plainly.

       It is deliberately not reachable from PROCESSING or SHIPPED. Once the
       parcel is being packed the question stops being "was this confirmed in
       error" and becomes "where is the stock", which is a cancellation or a
       refund. And it is not offered through the generic transition endpoint:
       see `AdminOrdersService.transition`, which refuses it and points at
       `revertPaymentConfirmation` — the only caller that also voids the
       payment row and un-counts the sale. A bare status flip would leave both
       behind. */
    PAYMENT_CONFIRMED: ["PROCESSING", "CANCELLED", "REFUNDED", "PENDING"],

    // Picked and packed. Still cancellable — nothing has left the building.
    PROCESSING: ["SHIPPED", "CANCELLED"],

    // The point of no return for cancellation. Once it is with the courier the
    // only way back is a refund, which is a different, money-moving action.
    SHIPPED: ["DELIVERED", "REFUNDED"],

    DELIVERED: ["REFUNDED"],

    // Terminal. A cancelled order is not resurrected — a customer who changes
    // their mind places a new one, so that stock and coupon accounting stay
    // append-only rather than needing to be un-done.
    CANCELLED: [],
    REFUNDED: [],
  } satisfies Record<OrderStatus, readonly OrderStatus[]>);

/**
 * Statuses from which stock has been committed but not yet handed over.
 *
 * Kept next to the transition table because it is derived from the same
 * lifecycle: these are exactly the statuses whose cancellation must return
 * stock via InventoryService.increment. Getting this list out of step with the
 * table above is how a cancellation silently loses inventory.
 */
export const STOCK_HELD_STATUSES: readonly OrderStatus[] = Object.freeze([
  "PENDING",
  "PAYMENT_CONFIRMED",
  "PROCESSING",
]);

/**
 * Whether moving `from` → `to` puts copies back on the shelf.
 *
 * Derived from the two structures above rather than being a third list to keep
 * in step: stock is held in exactly the STOCK_HELD_STATUSES, and it stops
 * being held when the order reaches a status with nowhere left to go. So an
 * order abandoned before dispatch — cancelled, or refunded after payment but
 * before picking — returns its copies, and one that has physically left the
 * building does not, because the copies left with it.
 *
 * The case worth naming is PAYMENT_CONFIRMED → REFUNDED. It is easy to read
 * "refund" as always meaning the goods are gone, and for SHIPPED and DELIVERED
 * it does. For an order refunded before dispatch it does not: those copies are
 * still on the shelf, and leaving them decremented is inventory the shop
 * cannot sell and cannot see.
 *
 * `OrdersService.transition` applies this itself, so no caller can move an
 * order to a terminal status and forget the stock — which is the bug
 * STOCK_HELD_STATUSES' comment warns about, closed by construction rather than
 * by remembering.
 */
export function releasesStock(from: OrderStatus, to: OrderStatus): boolean {
  return STOCK_HELD_STATUSES.includes(from) && isTerminal(to);
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_STATUS_TRANSITIONS[from].includes(to);
}

/** True for statuses with no outgoing transitions. */
export function isTerminal(status: OrderStatus): boolean {
  return ORDER_STATUS_TRANSITIONS[status].length === 0;
}

/**
 * The statuses an order must enter, in order, to get from `from` to `to`.
 *
 * The shortest route through the table above — `[PROCESSING, SHIPPED]` for an
 * order sitting at PAYMENT_CONFIRMED that is being marked shipped. Empty when
 * the order is already there, and null when no route exists at all (a
 * cancelled order asked to ship, a delivered one asked to go back).
 *
 * This exists because the lifecycle and the desk disagree about granularity,
 * and only one of them is wrong to. Staff hand a stack of parcels to the
 * courier in one action; the machine insists an order is picked before it is
 * dispatched. Making the panel fire two requests would put the ordering of
 * those steps in the browser, where a dropped second request leaves an order
 * stranded in PROCESSING with a parcel already gone. Computing the route here
 * and walking it inside one transaction keeps the intermediate statuses real —
 * each gets its own history row, so the customer's timeline shows the order
 * was picked and then dispatched — without asking the caller to know that
 * PROCESSING is in the way.
 *
 * **No route ever passes through a terminal status.** That is not a filter
 * applied here, it is a property of the table: CANCELLED and REFUNDED have no
 * outgoing transitions, so breadth-first search cannot leave them. Which means
 * this can never quietly cancel an order on the way to shipping it — the one
 * failure that would make walking a path worse than refusing to.
 *
 * Breadth-first rather than a hardcoded happy path, so a status inserted into
 * the lifecycle is routed through automatically instead of being skipped by a
 * list nobody remembered to update.
 */
export function forwardPathTo(from: OrderStatus, to: OrderStatus): OrderStatus[] | null {
  if (from === to) return [];

  const previous = new Map<OrderStatus, OrderStatus>();
  const seen = new Set<OrderStatus>([from]);
  const queue: OrderStatus[] = [from];

  while (queue.length > 0) {
    const current = queue.shift()!;

    for (const next of ORDER_STATUS_TRANSITIONS[current]) {
      if (seen.has(next)) continue;

      seen.add(next);
      previous.set(next, current);

      if (next === to) {
        const path: OrderStatus[] = [];
        for (let step: OrderStatus = to; step !== from; step = previous.get(step)!) {
          path.unshift(step);
        }
        return path;
      }

      queue.push(next);
    }
  }

  return null;
}
