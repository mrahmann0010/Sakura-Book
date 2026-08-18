import type { OrderStatus } from "./order-status.machine";

/**
 * Domain events emitted by the orders module.
 *
 * In-process, via Nest's EventEmitter2 — not a queue. The only consumer today
 * is the `units_sold` rollup, whose whole requirement is "not inline in the
 * checkout transaction"; a broker would add an operational dependency to
 * satisfy a constraint that a deferred function call already satisfies. The
 * day a listener needs to survive a restart, that is the signal to introduce
 * one, and this event name is what it would carry.
 *
 * The name itself lives in common/events.ts — see the comment there for why
 * the channel identifier cannot live next to the payload without creating an
 * import cycle between orders and inventory.
 */
export { ORDER_STATUS_CHANGED } from "../common/events";
export type OrderStatusChangedEvent = {
  orderId: string;
  orderNumber: string;
  from: OrderStatus;
  to: OrderStatus;
};
