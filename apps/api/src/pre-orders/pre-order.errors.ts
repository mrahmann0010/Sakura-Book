import type { PreOrderFulfillmentStatus, PreOrderPaymentStatus } from "@sakura/contracts";
import { BusinessRuleError } from "../common/errors";
import {
  PRE_ORDER_FULFILLMENT_TRANSITIONS,
  PRE_ORDER_PAYMENT_TRANSITIONS,
} from "./pre-order-status.machine";

/**
 * A move neither lifecycle permits.
 *
 * BusinessRuleError (422) rather than ConflictError (409) for the reason
 * order.errors.ts sets out: an identical retry fails identically, so this is
 * an answer of no rather than a race that resolves. The allowed set travels in
 * `details` so the panel can grey the button out instead of discovering the
 * rule by trial.
 */
export class InvalidPreOrderPaymentTransitionError extends BusinessRuleError {
  readonly code = "INVALID_STATUS_TRANSITION";

  constructor(orderNumber: string, from: PreOrderPaymentStatus, to: PreOrderPaymentStatus) {
    super(`Pre-order ${orderNumber} payment cannot move from ${from} to ${to}`, {
      orderNumber,
      track: "payment",
      from,
      to,
      allowed: PRE_ORDER_PAYMENT_TRANSITIONS[from],
    });
  }
}

export class InvalidPreOrderFulfillmentTransitionError extends BusinessRuleError {
  readonly code = "INVALID_STATUS_TRANSITION";

  constructor(orderNumber: string, from: PreOrderFulfillmentStatus, to: PreOrderFulfillmentStatus) {
    super(`Pre-order ${orderNumber} fulfilment cannot move from ${from} to ${to}`, {
      orderNumber,
      track: "fulfillment",
      from,
      to,
      allowed: PRE_ORDER_FULFILLMENT_TRANSITIONS[from],
    });
  }
}

/**
 * Dispatch attempted before the money was verified — the one rule that spans
 * the two tracks.
 *
 * Its own error rather than a transition failure, because the fulfilment move
 * itself was legal: what is missing is a fact from the other column, and a
 * message naming the fulfilment table would send the reader to the wrong
 * lifecycle looking for a rule that is not there.
 */
export class PreOrderPaymentNotAcceptedError extends BusinessRuleError {
  readonly code = "PAYMENT_NOT_ACCEPTED";

  constructor(orderNumber: string, paymentStatus: PreOrderPaymentStatus) {
    super(
      `Pre-order ${orderNumber} cannot be fulfilled until its payment is accepted (currently ${paymentStatus}).`,
      { orderNumber, paymentStatus },
    );
  }
}
