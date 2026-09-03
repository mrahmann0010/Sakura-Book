import { z } from "zod";
import { paymentProviders } from "./payment-verification";

/* --------------------------------------------------------------------------
   The payment breakdown — where the money on accepted orders came from, and
   what it was for.

   A separate concern from admin-dashboard.ts, which answers "how is trade
   going" over time. This answers "what is in the accounts": one window, split
   two ways at once — by component (books vs delivery vs discount) and by the
   wallet the money moved through.

   Its own file rather than an addition to the dashboard contract because the
   two are fetched by different screens and neither needs the other's shape.
   -------------------------------------------------------------------------- */

/**
 * The windows the screen offers.
 *
 * Named keys rather than only a from/to pair, because the presets are not
 * merely shorthand for dates a client could compute: their boundaries are
 * *shop-timezone* day edges, and a browser computing "last 7 days" from its
 * own clock would ask for a window that does not line up with the one the
 * dashboard reports — two screens quietly disagreeing about what a day is.
 * The server owns the calendar; the client names a window.
 */
export const paymentBreakdownRanges = ["all", "today", "7d", "30d", "month", "custom"] as const;
export type PaymentBreakdownRange = (typeof paymentBreakdownRanges)[number];

/**
 * What the money moved through.
 *
 * The three wallets, plus cash on delivery — which is not a `provider` at all
 * (the column is null for it) but is unquestionably a way the shop gets paid,
 * and the largest one. Reporting it as "no provider" would hide a third of
 * the takings behind a null.
 *
 * `other` is the honest bucket for a manual transfer whose provider was never
 * recorded — the column is nullable and predates the checkout field that now
 * fills it, so old rows exist. Filing those under bKash because it is the
 * likeliest wallet would be inventing data; leaving them out would make the
 * platform rows fail to sum to the headline, which is the one property this
 * screen cannot lose.
 */
export const paymentPlatforms = [...paymentProviders, "cash-on-delivery", "other"] as const;
export type PaymentPlatform = (typeof paymentPlatforms)[number];

export const paymentBreakdownQuerySchema = z.object({
  range: z.enum(paymentBreakdownRanges).default("all"),
  /** Required when `range` is `custom`, ignored otherwise. Shop-timezone dates. */
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
    .optional(),
});

export type PaymentBreakdownQuery = z.infer<typeof paymentBreakdownQuerySchema>;

/**
 * The four money figures, and the two that split the total by whether it has
 * actually arrived. Shared by the totals block and by every platform row, so
 * a row and the headline can never be shaped differently.
 *
 * `totalCents = booksCents + deliveryCents - discountCents`, and
 * `totalCents = collectedCents + expectedCents`. Both identities hold for
 * every row and for the totals; the screen draws them as arithmetic and would
 * visibly break if they stopped being true.
 */
export const paymentTotalsSchema = z.object({
  orderCount: z.number().int().nonnegative(),
  /** Sum of `subtotalCents` — what the books themselves came to. */
  booksCents: z.number().int().nonnegative(),
  /** Sum of `shippingCents` — the delivery fee collected. */
  deliveryCents: z.number().int().nonnegative(),
  /** Sum of `discountCents`, as a positive number. It is deducted, not added. */
  discountCents: z.number().int().nonnegative(),
  /** Sum of `totalCents` — what the customer was charged. */
  totalCents: z.number().int().nonnegative(),
  /**
   * The part of `totalCents` that is money in hand: every wallet transfer,
   * plus cash on delivery only once the order reached DELIVERED.
   */
  collectedCents: z.number().int().nonnegative(),
  /** The remainder — cash on delivery still with a courier. */
  expectedCents: z.number().int().nonnegative(),
});

export type PaymentTotals = z.infer<typeof paymentTotalsSchema>;

export const platformBreakdownSchema = paymentTotalsSchema.extend({
  platform: z.enum(paymentPlatforms),
});

export type PlatformBreakdown = z.infer<typeof platformBreakdownSchema>;

export const paymentBreakdownSchema = z.object({
  currency: z.string().length(3),
  timezone: z.string(),
  /** The window as the server resolved it. `from`/`to` are null for `all`. */
  range: z.object({
    key: z.enum(paymentBreakdownRanges),
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
  }),
  totals: paymentTotalsSchema,
  averageOrderValueCents: z.number().int().nonnegative(),
  /** Busiest platform first. Platforms with no orders in the window are absent. */
  platforms: z.array(platformBreakdownSchema),
});

export type PaymentBreakdown = z.infer<typeof paymentBreakdownSchema>;
