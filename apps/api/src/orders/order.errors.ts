import type { CartQuoteRejection } from "@sakura/contracts";
import { BusinessRuleError, ConflictError } from "../common/errors";
import { ORDER_STATUS_TRANSITIONS, type OrderStatus } from "./order-status.machine";

/**
 * A status change the lifecycle does not permit.
 *
 * A BusinessRuleError (422), not a ConflictError (409), and the distinction is
 * the one domain.error.ts draws: retrying will fail identically forever.
 * "Cancel a delivered order" is not a race that resolves — it is an answer of
 * no. The allowed set travels in details so an admin UI can grey out the
 * buttons rather than discovering the rule by trial.
 */
export class InvalidStatusTransitionError extends BusinessRuleError {
  readonly code = "INVALID_STATUS_TRANSITION";

  constructor(orderId: string, from: OrderStatus, to: OrderStatus) {
    super(`Order ${orderId} cannot move from ${from} to ${to}`, {
      orderId,
      from,
      to,
      allowed: ORDER_STATUS_TRANSITIONS[from],
    });
  }
}

/**
 * The order could not be placed because one or more lines are not orderable.
 *
 * The cart endpoint reports the same rejections in a 200 body, because there
 * the customer is still shopping and a dropped line is information. Here it is
 * a refusal: the customer pressed Place Order for a basket that included
 * something we cannot sell them, and quietly shipping the rest would be
 * charging them for an order they did not agree to.
 *
 * A BusinessRuleError (422) rather than a conflict even when the reason is
 * OUT_OF_STOCK, and the distinction is between *this* request and the stock
 * race at decrement time. A book that was already at zero when the cart was
 * priced will still be at zero on an identical retry; the request has to
 * change. OutOfStockError — thrown from InventoryService.decrement, and a 409 —
 * is the genuinely transient one, where the last copy went to someone else
 * mid-transaction.
 *
 * The rejections travel in details verbatim so the cart page can mark the
 * offending rows without a second round trip.
 */
export class CartNotOrderableError extends BusinessRuleError {
  readonly code = "CART_NOT_ORDERABLE";

  constructor(rejected: CartQuoteRejection[]) {
    super(`${rejected.length} cart line(s) cannot be ordered`, { rejected });
  }
}

/**
 * A discount code was sent with the order and does not apply.
 *
 * Refusing rather than dropping it, because the customer was shown a discounted
 * total on the checkout page and charging them the undiscounted one without
 * saying so is the worst available outcome. `reason` is the same
 * CouponRejectionReason the cart renders beside the input, so the client
 * already has a message for it.
 */
export class CouponNotApplicableError extends BusinessRuleError {
  readonly code = "COUPON_NOT_APPLICABLE";

  constructor(code: string, reason: string) {
    super(`Coupon '${code}' does not apply to this order: ${reason}`, { code, reason });
  }
}

/**
 * An order number could not be minted in ORDER_NUMBER_ATTEMPTS draws.
 *
 * Retryable in principle, hence a conflict — but in practice this means the
 * number space is too full for its size and the format needs widening, which
 * is why it is a distinct code rather than folded into a generic 409. Nobody
 * should ever see it; if it appears in the logs it is a capacity signal.
 */
export class OrderNumberExhaustedError extends ConflictError {
  readonly code = "ORDER_NUMBER_UNAVAILABLE";

  constructor(attempts: number) {
    super(`Could not allocate a unique order number in ${attempts} attempts`, {
      attempts,
      retryable: true,
    });
  }
}
