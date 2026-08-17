import { COUPON_REJECTION_REASONS, type CouponRejectionReason } from "@sakura/contracts";
import type { InferSelectModel } from "drizzle-orm";
import type { coupons } from "../db/schema";

export type Coupon = InferSelectModel<typeof coupons>;
export type { CouponRejectionReason };

/**
 * Why a coupon was refused. Returned rather than thrown: at checkout the
 * frontend needs to render a specific message ("this code expired") next to the
 * input, and an exception per case would make that a string-matching exercise.
 *
 * Derived from the contract rather than declared here. These strings are read
 * by the frontend to pick which message to show, so the two lists agreeing is
 * not a nice-to-have — and two hand-maintained copies of a union is exactly
 * the drift @sakura/contracts exists to make impossible. Adding a reason is
 * now a change in one file that fails the other side's typecheck until it is
 * handled.
 */
export const CouponRejection = Object.fromEntries(
  COUPON_REJECTION_REASONS.map((reason) => [reason, reason]),
) as { readonly [R in CouponRejectionReason]: R };

export type CouponEvaluation =
  | { ok: true; coupon: Coupon; discountCents: number }
  | { ok: false; reason: CouponRejectionReason; minOrderCents?: number };
