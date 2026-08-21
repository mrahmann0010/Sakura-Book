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
  /**
   * The division the shop is currently shipping from. Not a closed enum here:
   * the full 8-division list lives in the web app's bd-geo data, and this
   * package only needs to carry the slug through, not validate it against
   * Bangladesh's geography.
   *
   * Zone pricing (`inside-dhaka` / `outside-dhaka` today) is relative to this,
   * not hardcoded to Dhaka — the shop's shipment point moves (a different
   * warehouse, a publisher shipping direct), and clients compare the
   * customer's destination division against this value rather than assuming
   * it is always "dhaka".
   */
  originDivision: z.string().trim().min(1),
  regions: z.array(shippingRegionSchema),
});

export type ShippingRegion = z.infer<typeof shippingRegionSchema>;
export type ShippingTerms = z.infer<typeof shippingTermsSchema>;
