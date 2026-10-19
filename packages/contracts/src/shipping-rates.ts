/* --------------------------------------------------------------------------
   What a parcel costs to post — Pathao's weight ladder, per tier.

   One pure function, shared: the checkout renders a live estimate with it and
   the API computes the authoritative number with the same call, from its own
   book weights. One table, so what a customer is shown and what they are
   charged cannot drift apart.

   ## What staff can edit, and what they cannot

   The ≤0.5kg price of each tier is the `deliveryCentsOverride` on that tier's
   `delivery_regions` row, edited on the admin Shipping page. The steps above
   it — the 1kg and 2kg bands and the per-extra-kg charge — are carried here as
   amounts *on top of* that start price, so a Pathao price rise edited in the
   panel lifts the whole ladder with it. Making the steps editable too is a
   schema change, and is deliberately not part of this one.

   Source: Pathao's published rate card, Oct 2026. Review quarterly.
   -------------------------------------------------------------------------- */

import type { ShippingTier } from "./shipping-zones";

/** Guard: these rates are only valid for a Dhaka-city pickup point. */
export const PICKUP_TIER: ShippingTier = "ISD";

export type TierLadder = {
  /** The ≤0.5kg price, in minor units — the default when no override is saved. */
  startCents: number;
  /** Added to the start price for a parcel over 0.5kg and up to 1kg. */
  upTo1kgStepCents: number;
  /** Added to the start price for a parcel over 1kg and up to 2kg. */
  upTo2kgStepCents: number;
  /** Per additional kg, or part thereof, above 2kg. */
  extraPerKgCents: number;
};

export const RATE_LADDER: Readonly<Record<ShippingTier, TierLadder>> = {
  // ৳60 / ৳70 / ৳90, then ৳15 per kg.
  ISD: { startCents: 6000, upTo1kgStepCents: 1000, upTo2kgStepCents: 3000, extraPerKgCents: 1500 },
  // ৳80 / ৳100 / ৳130, then ৳25 per kg.
  SUBURB: {
    startCents: 8000,
    upTo1kgStepCents: 2000,
    upTo2kgStepCents: 5000,
    extraPerKgCents: 2500,
  },
  // ৳110 / ৳130 / ৳170, then ৳25 per kg.
  OSD: {
    startCents: 11000,
    upTo1kgStepCents: 2000,
    upTo2kgStepCents: 6000,
    extraPerKgCents: 2500,
  },
};

/**
 * What a book with no `weightGrams` on file counts as, packed.
 *
 * 249g so that the bands land where the shop prices them: two books stay at or
 * under 0.5kg, four at or under 1kg. A weight entered in the book form is read
 * the same way — as the book in its packaging — which is why the allowance
 * below is zero rather than a separate mailer weight added on top.
 */
export const DEFAULT_BOOK_WEIGHT_GRAMS = 249;

/** Added once per parcel. Zero — see DEFAULT_BOOK_WEIGHT_GRAMS. */
export const PACKAGING_WEIGHT_GRAMS = 0;

/** A parcel's weight from its lines. `weightGrams` null means not on file. */
export function parcelWeightGrams(
  lines: readonly { weightGrams: number | null | undefined; quantity: number }[],
): number {
  if (lines.length === 0) return 0;

  const books = lines.reduce(
    (sum, line) => sum + (line.weightGrams ?? DEFAULT_BOOK_WEIGHT_GRAMS) * line.quantity,
    0,
  );

  return books + PACKAGING_WEIGHT_GRAMS;
}

/**
 * Postage for a parcel of `weightGrams` to a zone in `tier`, in minor units.
 *
 * `startCents` is the tier's saved ≤0.5kg price; null or undefined uses the
 * ladder's default. Above 2kg Pathao bills per kg *or part thereof*, so 2.1kg
 * costs what 3kg does — `Math.ceil` matches that, and rounding down would be a
 * steady leak on exactly the heavier orders.
 */
export function shippingCentsFor(
  tier: ShippingTier,
  weightGrams: number,
  startCents?: number | null,
): number {
  const ladder = RATE_LADDER[tier];
  const start = startCents ?? ladder.startCents;

  if (weightGrams <= 500) return start;
  if (weightGrams <= 1000) return start + ladder.upTo1kgStepCents;

  const twoKg = start + ladder.upTo2kgStepCents;
  if (weightGrams <= 2000) return twoKg;

  return twoKg + Math.ceil((weightGrams - 2000) / 1000) * ladder.extraPerKgCents;
}
