import { ConflictError } from "../common/errors";

/**
 * Redemption lost the race for the last use of a coupon.
 *
 * Note the asymmetry with CouponRejection in ./coupon.types: evaluate() returns
 * its refusals as values because they are the expected answer to "is this code
 * any good?" — the caller is asking, and a thrown exception per case would make
 * that a control-flow mess. redeem() throws, because by then the customer is
 * mid-checkout, the coupon already passed evaluation, and the only correct
 * outcome is to abort. Throwing is also what rolls back the enclosing
 * transaction, so the order is never written with a discount that was not
 * actually granted.
 */
export class CouponUnavailableError extends ConflictError {
  readonly code = "COUPON_UNAVAILABLE";

  constructor(couponId: string) {
    super(
      `Coupon ${couponId} was exhausted or deactivated between validation and redemption`,
      // retryable is false in the sense that matters to a client: unlike a
      // serialisation failure, replaying this request will fail identically.
      // The customer has to remove the code, not retry.
      { couponId, retryable: false },
    );
  }
}
