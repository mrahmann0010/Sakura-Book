import { z } from "zod";

/* --------------------------------------------------------------------------
   Coupon validation — the advisory check behind the cart's "apply code" field.
   -------------------------------------------------------------------------- */

/**
 * Why a coupon was refused.
 *
 * Returned as a value on a 200, not thrown as an error: "this code expired" is
 * the expected answer to "is this code any good?", and the cart renders it
 * next to the input. A 4xx here would make the frontend's happy path an
 * exception handler. Contrast redemption at checkout, which throws
 * COUPON_UNAVAILABLE — by then the answer is genuinely a failure.
 *
 * This is the authoritative list. apps/api's CouponRejection re-exports it
 * rather than declaring its own, so the two cannot drift.
 */
export const COUPON_REJECTION_REASONS = [
  "NOT_FOUND",
  "INACTIVE",
  "NOT_STARTED",
  "EXPIRED",
  "USAGE_LIMIT_REACHED",
  "MIN_ORDER_NOT_MET",
] as const;

export type CouponRejectionReason = (typeof COUPON_REJECTION_REASONS)[number];

export const couponValidateRequestSchema = z.object({
  /** Stored and compared uppercase; the server normalises, so send it raw. */
  code: z.string().trim().min(1, "Enter a discount code.").max(64),
  subtotalCents: z.number().int().nonnegative(),
});

/**
 * Discriminated on `ok` so a client narrows with one check and gets either a
 * discount or a reason, never both and never neither.
 */
export const couponEvaluationSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    code: z.string(),
    discountCents: z.number().int().nonnegative(),
  }),
  z.object({
    ok: z.literal(false),
    reason: z.enum(COUPON_REJECTION_REASONS),
    /** Present only on MIN_ORDER_NOT_MET — "spend ৳200 more" needs the target. */
    minOrderCents: z.number().int().nonnegative().optional(),
  }),
]);

export type CouponValidateRequest = z.infer<typeof couponValidateRequestSchema>;
export type CouponEvaluation = z.infer<typeof couponEvaluationSchema>;
