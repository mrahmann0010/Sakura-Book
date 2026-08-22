/* --------------------------------------------------------------------------
   Checkout contract — re-exported from @sakura/contracts.

   The schema itself now lives in packages/contracts, because the form and the
   endpoint that accepts the order have to agree about what a valid order is,
   and two copies of a zod schema agree right up until someone edits one. The
   API validates with this exact object.

   This file stays as the import site so components keep importing
   "@/lib/checkout" — and because `regions` below is genuinely local: display
   labels for zones the API validates by slug, not the source of truth.
   -------------------------------------------------------------------------- */

export {
  acceptedPaymentMethods,
  checkoutDefaults,
  checkoutSchema,
  methodNeedsTransferDetails,
  paymentMethods,
  type AcceptedPaymentMethod,
  type CheckoutValues,
  type PaymentMethod,
} from "@sakura/contracts";

import { acceptedPaymentMethods, type PaymentMethod } from "@sakura/contracts";

/**
 * Card is drawn in the wireframe but marked "later", so it ships disabled.
 *
 * Aliases the contract's `acceptedPaymentMethods`: the server refuses anything
 * outside this list, so the form and the API disable the same option for the
 * same reason rather than by coincidence.
 */
export const availablePaymentMethods: readonly PaymentMethod[] = acceptedPaymentMethods;

/**
 * Delivery zones. Slugs match the `delivery_regions` rows seeded in
 * apps/api/src/db/seed/reference.ts and are validated server-side against
 * that table — this is the label lookup, not the source of truth.
 *
 * The customer no longer picks one: `deliveryZoneFor` in ./bd-geo derives it
 * from the division they select in the address form.
 */
export const regions = [
  { value: "inside-dhaka", label: "Inside Dhaka" },
  { value: "outside-dhaka", label: "Outside Dhaka" },
] as const;

export type Region = (typeof regions)[number]["value"];
