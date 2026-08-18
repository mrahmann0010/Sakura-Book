import type { CartQuote, CartQuoteRejection } from "@sakura/contracts";

/**
 * What pricing actually computes — a superset of what crosses the wire.
 *
 * There are two consumers and they need different things. `/cart/quote` needs
 * the client-facing figures. Checkout needs those *plus* the couponId whose
 * `timesUsed` it must increment, and the author/title/price snapshot it freezes
 * onto each order line. Returning one object that carries both, and narrowing
 * it at the controller with `toCartQuote`, is what lets checkout re-price with
 * the same call the quote endpoint uses rather than a parallel implementation
 * of the same ladder — which is the whole point of §3.8.
 *
 * The rule for what may be added here: internal fields, never a second version
 * of a wire field. If a number differs between this and CartQuote, one of them
 * is a bug.
 */
export type PricedLine = {
  bookId: string;
  slug: string;
  title: string;
  authors: string[];
  coverImageUrl: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  stockQuantity: number;
};

export type PricedCoupon = {
  /** Internal. Never leaves the server — see CouponsController's narrowing. */
  id: string;
  code: string;
  discountCents: number;
};

export type PricedCart = {
  currency: string;
  lines: PricedLine[];
  rejected: CartQuoteRejection[];

  subtotalCents: number;
  deliveryBaseCents: number;
  deliveryCents: number;
  deliveryCreditCents: number;

  coupon?: PricedCoupon;
  couponRejection?: string;

  totalCents: number;
  freeDeliveryThresholdCents: number;
};

/** Drops the internal fields. The one place PricedCart becomes a response. */
export function toCartQuote(priced: PricedCart): CartQuote {
  return {
    currency: priced.currency,
    lines: priced.lines,
    rejected: priced.rejected,

    lineCount: priced.lines.length,
    itemCount: priced.lines.reduce((count, line) => count + line.quantity, 0),

    subtotalCents: priced.subtotalCents,
    deliveryBaseCents: priced.deliveryBaseCents,
    deliveryCents: priced.deliveryCents,
    deliveryCreditCents: priced.deliveryCreditCents,

    coupon: priced.coupon
      ? { code: priced.coupon.code, discountCents: priced.coupon.discountCents }
      : undefined,
    couponRejection: priced.couponRejection,

    totalCents: priced.totalCents,
    freeDeliveryThresholdCents: priced.freeDeliveryThresholdCents,
  };
}
