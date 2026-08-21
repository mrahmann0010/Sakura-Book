import { shippingTermsSchema, type ShippingTerms } from "@sakura/contracts";

import { apiFetch } from "./client";

/**
 * Delivery regions and the postage terms they're priced against — including
 * `originDivision`, the division the shop is currently shipping from. The
 * checkout address form uses it to derive a customer's zone (inside/outside
 * that origin) rather than assuming the shop always ships from Dhaka.
 */
export function getShippingTerms(): Promise<ShippingTerms> {
  return apiFetch("/shipping/regions", shippingTermsSchema, { revalidate: 300 });
}
