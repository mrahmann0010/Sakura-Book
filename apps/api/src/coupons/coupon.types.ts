import type { InferSelectModel } from "drizzle-orm";
import type { coupons } from "../db/schema";

export type Coupon = InferSelectModel<typeof coupons>;

/**
 * Why a coupon was refused. Returned rather than thrown: at checkout the
 * frontend needs to render a specific message ("this code expired") next to the
 * input, and an exception per case would make that a string-matching exercise.
 */
export const CouponRejection = {
  NOT_FOUND: "NOT_FOUND",
  INACTIVE: "INACTIVE",
  NOT_STARTED: "NOT_STARTED",
  EXPIRED: "EXPIRED",
  USAGE_LIMIT_REACHED: "USAGE_LIMIT_REACHED",
  MIN_ORDER_NOT_MET: "MIN_ORDER_NOT_MET",
} as const;

export type CouponRejectionReason = (typeof CouponRejection)[keyof typeof CouponRejection];

export type CouponEvaluation =
  | { ok: true; coupon: Coupon; discountCents: number }
  | { ok: false; reason: CouponRejectionReason; minOrderCents?: number };
