import { paymentNumbersSchema, type PaymentNumbers } from "@sakura/contracts";

import { apiFetch } from "./client";

/**
 * The bKash/Rocket/Nagad numbers checkout shows for manual transfer.
 *
 * Read from the API rather than `NEXT_PUBLIC_*` env vars: those were baked
 * into the browser bundle at build time, which meant changing a number
 * required a redeploy — and the checkout control that displayed them also
 * let anyone editing the page type over them locally. Payment Settings in the
 * admin panel is now the only place these change.
 */
export function getPaymentNumbers(): Promise<PaymentNumbers> {
  return apiFetch("/payments/numbers", paymentNumbersSchema, { revalidate: 300 });
}
