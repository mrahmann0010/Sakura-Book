/* --------------------------------------------------------------------------
   Checkout contract — re-exported from @sakura/contracts.

   The schema itself now lives in packages/contracts, because the form and the
   endpoint that accepts the order have to agree about what a valid order is,
   and two copies of a zod schema agree right up until someone edits one. The
   API validates with this exact object.

   This file stays as the import site so components keep importing
   "@/lib/checkout" — and because the two things below are genuinely local:
   placeholder data the API does not serve yet, and a stand-in for an id only
   the server can mint.
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
 * Delivery regions. Still a placeholder list, and deliberately not moved into
 * the contract: the regions table (Phase 1) and GET /shipping/regions own this
 * vocabulary, so freezing today's five values into a shared package would make
 * adding a sixth a package release. `region` is a slug string in the schema
 * and is validated server-side against the table.
 */
export const regions = [
  { value: "dhaka", label: "Dhaka" },
  { value: "chattogram", label: "Chattogram" },
  { value: "sylhet", label: "Sylhet" },
  { value: "khulna", label: "Khulna" },
  { value: "rajshahi", label: "Rajshahi" },
] as const;

export type Region = (typeof regions)[number]["value"];

/**
 * Placeholder order id, in the shape the design system's `OrderId` renders and
 * the "Order IDs are eight characters, like MG-40718" copy promises.
 * Replaced by the `orderNumber` the API returns.
 */
export function draftOrderId(): string {
  return `MG-${Math.floor(10000 + Math.random() * 89999)}`;
}
