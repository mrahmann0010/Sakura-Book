import { z } from "zod";

/* --------------------------------------------------------------------------
   Coupons, as the owner manages them.

   coupon.ts is the storefront's half — "is this code any good?" and nothing
   about how many uses are left. Everything here is the other side of that
   wall: usage counts, limits, the on/off switch. ADMIN only, because a coupon
   changes what a customer pays (see ADMIN_ROLES).
   -------------------------------------------------------------------------- */

export const COUPON_DISCOUNT_TYPES = ["PERCENTAGE", "FIXED_AMOUNT"] as const;
export type CouponDiscountType = (typeof COUPON_DISCOUNT_TYPES)[number];

/**
 * Where a coupon stands *right now*, derived from its columns rather than
 * stored. Order of precedence is the order a customer would hit them in
 * CouponsService.evaluate: switched off beats everything, then the window,
 * then the usage limit.
 */
export const ADMIN_COUPON_STATES = ["ACTIVE", "SCHEDULED", "EXPIRED", "USED_UP", "DISABLED"] as const;
export type AdminCouponState = (typeof ADMIN_COUPON_STATES)[number];

/**
 * Codes customers type on a phone keyboard: letters, digits, dash and
 * underscore. Uppercased here so the client, the server and the database's
 * `coupons_code_uppercase` check all agree before anything is written.
 */
export const couponCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(3, "Codes are at least 3 characters.")
  .max(32, "Codes are at most 32 characters.")
  .regex(/^[A-Z0-9_-]+$/, "Use letters, numbers, dashes or underscores only.");

const isoDateTime = z.iso.datetime({ offset: true });

export const adminCouponSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  discountType: z.enum(COUPON_DISCOUNT_TYPES),
  /** 1–100 for PERCENTAGE, paisa for FIXED_AMOUNT. */
  discountValue: z.number().int().positive(),
  minOrderCents: z.number().int().nonnegative().nullable(),
  maxDiscountCents: z.number().int().positive().nullable(),
  maxUses: z.number().int().positive().nullable(),
  timesUsed: z.number().int().nonnegative(),
  startsAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  isActive: z.boolean(),
  state: z.enum(ADMIN_COUPON_STATES),
  /** Sum of the discount snapshot on orders placed with this code, excluding cancelled and refunded ones. */
  totalDiscountCents: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AdminCoupon = z.infer<typeof adminCouponSchema>;

export const adminCouponQuerySchema = z.object({
  state: z.enum(ADMIN_COUPON_STATES).optional(),
  /** Substring of the code. */
  q: z.string().trim().min(1).max(64).optional(),
});

export type AdminCouponQuery = z.infer<typeof adminCouponQuerySchema>;

export const adminCouponCountsSchema = z.object(
  Object.fromEntries(ADMIN_COUPON_STATES.map((state) => [state, z.number().int().nonnegative()])) as {
    [S in AdminCouponState]: z.ZodNumber;
  },
);

export type AdminCouponCounts = z.infer<typeof adminCouponCountsSchema>;

/**
 * Not paginated: a shop issues dozens of codes, not thousands, and the tab
 * counts need every row anyway.
 */
export const adminCouponListSchema = z.object({
  items: z.array(adminCouponSchema),
  counts: adminCouponCountsSchema,
});

export type AdminCouponList = z.infer<typeof adminCouponListSchema>;

/** The fields that make up a coupon's terms, shared by create and update. */
const couponTermsShape = {
  discountType: z.enum(COUPON_DISCOUNT_TYPES),
  discountValue: z.number().int().positive("Enter a discount above zero."),
  minOrderCents: z.number().int().positive().nullable(),
  /** Only meaningful for PERCENTAGE; forced to null for FIXED_AMOUNT. */
  maxDiscountCents: z.number().int().positive().nullable(),
  maxUses: z.number().int().positive().nullable(),
  startsAt: isoDateTime.nullable(),
  expiresAt: isoDateTime.nullable(),
  isActive: z.boolean(),
};

type TermsLike = {
  discountType?: CouponDiscountType;
  discountValue?: number;
  startsAt?: string | null;
  expiresAt?: string | null;
};

/**
 * The same rules as the table's check constraints, said here so the form can
 * show them beside the field instead of a 500 surfacing as "something went
 * wrong". The database still enforces them for any other write path.
 */
function checkTerms(value: TermsLike, ctx: z.RefinementCtx) {
  if (
    value.discountType === "PERCENTAGE" &&
    value.discountValue !== undefined &&
    value.discountValue > 100
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["discountValue"],
      message: "A percentage discount is at most 100.",
    });
  }

  if (value.startsAt && value.expiresAt && new Date(value.startsAt) >= new Date(value.expiresAt)) {
    ctx.addIssue({
      code: "custom",
      path: ["expiresAt"],
      message: "The end date must be after the start date.",
    });
  }
}

export const adminCouponCreateRequestSchema = z
  .object({ code: couponCodeSchema, ...couponTermsShape })
  .superRefine(checkTerms);

export type AdminCouponCreateRequest = z.infer<typeof adminCouponCreateRequestSchema>;

/**
 * Every term optional. The code is absent on purpose: it is what was printed
 * on the poster and sent in the SMS, and renaming it would silently break
 * every copy already in customers' hands. Issue a new code instead.
 *
 * The cross-field checks run again on the server against the merged row,
 * since a request changing only `expiresAt` cannot know the stored start.
 */
export const adminCouponUpdateRequestSchema = z
  .object(couponTermsShape)
  .partial()
  .superRefine(checkTerms)
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "Change at least one field.",
  });

export type AdminCouponUpdateRequest = z.infer<typeof adminCouponUpdateRequestSchema>;
