import { cartQuoteSchema, type CartItem, type CartQuote } from "@sakura/contracts";

import { apiFetch } from "./client";

/**
 * Prices a cart and resolves each entry against the real catalogue —
 * `buildCart`'s placeholder-catalogue lookup was retired in favour of this.
 * Not cached: stock and price are exactly what a customer must see fresh.
 */
export function quoteCart(
  items: CartItem[],
  opts: { couponCode?: string; region?: string } = {},
): Promise<CartQuote> {
  return apiFetch("/cart/quote", cartQuoteSchema, {
    method: "POST",
    body: { items, couponCode: opts.couponCode, region: opts.region },
    revalidate: false,
  });
}
