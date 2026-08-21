import type { PreOrderFulfillmentStatus, PreOrderPaymentStatus } from "@sakura/contracts";

/* --------------------------------------------------------------------------
   The pre-order lifecycle, as two machines rather than one.

   Same shape and the same reasoning as orders/order-status.machine.ts — a
   frozen, total Record so that adding a status to either pgEnum becomes a type
   error here until its outgoing moves are declared, instead of silently
   stranding every row that reaches it.

   What is different is that there are two tables, because a pre-order has two
   clocks: payment is verified within a day, fulfilment cannot start until the
   print run lands. They are not independent, though — see
   `canStartFulfillment` for the one rule that crosses between them.
   -------------------------------------------------------------------------- */

export const PRE_ORDER_PAYMENT_TRANSITIONS: Readonly<
  Record<PreOrderPaymentStatus, readonly PreOrderPaymentStatus[]>
> = Object.freeze({
  // A manual bKash/Rocket/Nagad transfer waits here until someone matches the
  // transaction ID against the statement. Both answers are available.
  PENDING: ["ACCEPTED", "REJECTED"],

  // Money is in. It can still go back out, which is the only move left: an
  // accepted pre-order is never un-accepted, because the customer has already
  // been told it is confirmed.
  ACCEPTED: ["REFUNDED"],

  // We turned the payment down — a wrong amount, an unmatchable reference.
  // Terminal: the customer places a new pre-order rather than having this one
  // resurrected, so the transaction ID on this row keeps meaning what it meant.
  REJECTED: [],

  REFUNDED: [],
} satisfies Record<PreOrderPaymentStatus, readonly PreOrderPaymentStatus[]>);

export const PRE_ORDER_FULFILLMENT_TRANSITIONS: Readonly<
  Record<PreOrderFulfillmentStatus, readonly PreOrderFulfillmentStatus[]>
> = Object.freeze({
  // Where a pre-order lives for most of its life, waiting on a print run.
  NOT_STARTED: ["PROCESSING", "CANCELLED"],

  // Picked and packed against real copies. Still cancellable — nothing has
  // left the building.
  PROCESSING: ["SHIPPED", "CANCELLED"],

  // The point of no return, exactly as for orders: once it is with the
  // courier, the way back is a refund on the *payment* track, which is a
  // different, money-moving decision made by a different person.
  SHIPPED: ["DELIVERED"],

  DELIVERED: [],
  CANCELLED: [],
} satisfies Record<PreOrderFulfillmentStatus, readonly PreOrderFulfillmentStatus[]>);

export function canTransitionPayment(
  from: PreOrderPaymentStatus,
  to: PreOrderPaymentStatus,
): boolean {
  return PRE_ORDER_PAYMENT_TRANSITIONS[from].includes(to);
}

export function canTransitionFulfillment(
  from: PreOrderFulfillmentStatus,
  to: PreOrderFulfillmentStatus,
): boolean {
  return PRE_ORDER_FULFILLMENT_TRANSITIONS[from].includes(to);
}

/**
 * The one rule that crosses the two tracks: nothing is picked, packed or
 * shipped until the money has been verified.
 *
 * Stated as its own predicate rather than baked into the fulfilment table
 * because it is not a property of the fulfilment lifecycle — NOT_STARTED →
 * PROCESSING is a perfectly legal move, it just needs a fact from the other
 * column to be true first. Cancelling is deliberately exempt: an unpaid
 * pre-order is exactly the kind that gets cancelled, and requiring payment
 * before allowing a cancellation would strand every rejected order in
 * NOT_STARTED forever.
 */
export function canStartFulfillment(paymentStatus: PreOrderPaymentStatus): boolean {
  return paymentStatus === "ACCEPTED";
}

export function isPaymentTerminal(status: PreOrderPaymentStatus): boolean {
  return PRE_ORDER_PAYMENT_TRANSITIONS[status].length === 0;
}

export function isFulfillmentTerminal(status: PreOrderFulfillmentStatus): boolean {
  return PRE_ORDER_FULFILLMENT_TRANSITIONS[status].length === 0;
}
