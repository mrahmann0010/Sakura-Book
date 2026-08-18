import { z } from "zod";

/** GET /shipping/regions — replaces the hardcoded `regions` in the web app. */
export const shippingRegionSchema = z.object({
  slug: z.string(),
  /** English name. Clients translate by slug; bn/ja bundles key off it. */
  name: z.string(),
  /**
   * Region-specific postage. Null means the flat national rate applies —
   * which is the only case today, but a Bangladeshi shop charging the same
   * inside and outside Dhaka is the exception, so the field exists from the
   * start rather than being a later breaking change.
   */
  deliveryCentsOverride: z.number().int().nonnegative().nullable(),
});

export const shippingTermsSchema = z.object({
  currency: z.string().length(3),
  flatRateCents: z.number().int().nonnegative(),
  freeDeliveryThresholdCents: z.number().int().nonnegative(),
  regions: z.array(shippingRegionSchema),
});

export type ShippingRegion = z.infer<typeof shippingRegionSchema>;
export type ShippingTerms = z.infer<typeof shippingTermsSchema>;
