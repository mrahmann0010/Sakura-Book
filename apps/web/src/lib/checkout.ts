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
 * Delivery tiers by their `delivery_regions` slug — the value an order stores
 * as `region`. Slugs match TIER_REGION_SLUG in @sakura/contracts and the rows
 * seeded in apps/api/src/db/seed/reference.ts; this is the label lookup, not
 * the source of truth.
 *
 * The customer never picks one: the server derives it from the zone they
 * choose in the address form.
 */
export const regions = [
  { value: "inside-dhaka", label: "Inside Dhaka" },
  { value: "dhaka-suburb", label: "Dhaka suburbs" },
  { value: "outside-dhaka", label: "Outside Dhaka" },
] as const;

export type Region = (typeof regions)[number]["value"];
