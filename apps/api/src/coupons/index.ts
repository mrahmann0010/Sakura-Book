/**
 * The coupons module's public surface.
 *
 * Everything outside this directory imports from here — `../coupons`, never
 * `../coupons/coupons.service`. That is what makes the boundary real rather
 * than decorative: the day redemption grows a second collaborator, or the
 * evaluation result changes shape, the blast radius is whatever this file
 * exports, and that set is visible in one place instead of inferred by
 * grepping for deep imports. Enforced by the no-restricted-imports rule in
 * eslint.config.mjs.
 */
export { CouponsModule } from "./coupons.module";
export { CouponsService } from "./coupons.service";
export { CouponUnavailableError } from "./coupon.errors";
export {
  CouponRejection,
  type Coupon,
  type CouponEvaluation,
  type CouponRejectionReason,
} from "./coupon.types";
