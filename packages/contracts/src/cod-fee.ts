/* --------------------------------------------------------------------------
   The cash-on-delivery charge — what the shop adds to a COD order to cover
   the courier's cash-handling fee.

   Pathao takes a percentage of the cash it collects (Oct 2026: about 0.5%
   inside Dhaka, 1% elsewhere). The shop charges the customer double that, so
   the fee is covered with room for refused parcels:

   - Dhaka city (ISD):            1% by default
   - Everywhere else (SUBURB+OSD): 2% by default — Pathao charges the suburbs
                                    at its outside-Dhaka rate, so they go
                                    together.

   One pure function, shared like `shippingCentsFor`: the API computes the
   authoritative figure and the web renders the same call's result from the
   quote, so a customer is never shown one fee and charged another.

   ## The rules

   - **Only COD pays it.** A bKash/Rocket/Nagad order has no courier cash to
     handle.
   - **Charged on what the courier collects**: books after discount, plus the
     delivery charge actually charged. The fee itself is not compounded.
   - **Not waived by free delivery.** The threshold waives postage; this is a
     payment-method charge, and a customer who wants it gone can prepay.
   - **Rounded up to the whole taka.** Pathao collects whole taka, and rounding
     down would make the fee short by design.
   - **Frozen on the order** (`orders.cod_fee_cents`), so "why was this ৳X?"
     stays answerable after the rates change.

   ## Who sets the rates

   Staff, on Admin → Settings → Shipping ("Cash-on-delivery charge"). They are
   stored on `shop_settings` and resolved per quote, inside checkout's
   transaction. A rate never saved falls back to DEFAULT_COD_FEE_RATES below.
   Rates are basis points (100 = 1%, 150 = 1.5%) so they stay integers like
   every other money figure here.
   -------------------------------------------------------------------------- */

import type { ShippingTier } from "./shipping-zones";

/** The two rates staff edit, in basis points. */
export type CodFeeRates = {
  /** Dhaka city — the ISD tier. */
  dhakaBps: number;
  /** Suburbs and outside Dhaka — the SUBURB and OSD tiers. */
  outsideBps: number;
};

export const DEFAULT_COD_FEE_RATES: Readonly<CodFeeRates> = Object.freeze({
  dhakaBps: 100,
  outsideBps: 200,
});

/** Upper bound staff can save: 10%. Anything above is a typo, not a policy. */
export const MAX_COD_FEE_BPS = 1_000;

/** Whole taka, in minor units. */
const ROUND_TO_CENTS = 100;

/**
 * The rate for a tier. Before a zone is known, the outside rate — the higher
 * one in any sane setup — so an early estimate can only fall when the
 * customer picks a Dhaka-city address.
 */
export function codFeeBpsFor(
  tier: ShippingTier | null | undefined,
  rates: CodFeeRates = DEFAULT_COD_FEE_RATES,
): number {
  return tier === "ISD" ? rates.dhakaBps : rates.outsideBps;
}

/**
 * The COD charge on `collectedCents` (books after discount + charged delivery)
 * for a parcel going to `tier`, rounded up to the whole taka. Zero for an
 * empty or free order, or a zero rate.
 */
export function codFeeCents(
  tier: ShippingTier | null | undefined,
  collectedCents: number,
  rates: CodFeeRates = DEFAULT_COD_FEE_RATES,
): number {
  if (collectedCents <= 0) return 0;

  const raw = (collectedCents * codFeeBpsFor(tier, rates)) / 10_000;
  return Math.ceil(raw / ROUND_TO_CENTS) * ROUND_TO_CENTS;
}
