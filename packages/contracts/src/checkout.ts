import { z } from "zod";
import { cartItemSchema } from "./cart";
import { paymentProviders } from "./payment-verification";

/* --------------------------------------------------------------------------
   Checkout. Moved here from apps/web/src/lib/checkout.ts, which now re-exports
   it — the form and the endpoint that accepts the order validate against one
   schema, so a rule can no longer be enforced on one side only.

   Validation messages state the fix rather than the fault, per the frontend's
   principle 03. They stay English: the API ships one language and the clients
   ship three, so a translated client renders from `code` + `path` (see
   fieldErrorMap in ./errors) and these are the developer/fallback strings.
   -------------------------------------------------------------------------- */

/** Card is drawn in the wireframe and explicitly deferred (§2). */
export const paymentMethods = ["cash-on-delivery", "manual-transfer", "card"] as const;
export type PaymentMethod = (typeof paymentMethods)[number];

/**
 * What the API will actually accept today. Separate from `paymentMethods` so
 * the form can render a disabled card option without the server having to
 * accept it — "visible but not orderable" is a UI state, not a contract.
 */
export const acceptedPaymentMethods = ["cash-on-delivery", "manual-transfer"] as const;
export type AcceptedPaymentMethod = (typeof acceptedPaymentMethods)[number];

const required = (fix: string) => z.string().trim().min(1, fix);

export const shippingAddressSchema = z.object({
  fullName: required("Add the name the parcel should be addressed to."),
  email: z.string().trim().email("Use an address like you@example.com so we can send updates."),
  phone: required("Add a number the courier can reach you on."),
  address: required("Add the street, house and area so the courier can find you."),
  city: required("Add the town or city."),
  /**
   * A slug from GET /shipping/regions, not a closed enum. The five values in
   * the web app are a placeholder list; once the regions table exists (Phase 1)
   * adding a sixth must not require releasing this package.
   */
  region: required("Choose the delivery region."),
});

export const checkoutSchema = shippingAddressSchema
  .extend({
    method: z.enum(acceptedPaymentMethods),
    /* Transfer details are only asked for when the transfer option is open, so
       they are optional at the field level and required by the refinement. */
    /** Which wallet the transfer moved through — bKash, Rocket or Nagad. */
    provider: z.enum(paymentProviders).optional(),
    senderNumber: z.string().trim().optional(),
    transactionId: z.string().trim().optional(),
    notes: z.string().trim().max(500, "Keep delivery notes under 500 characters.").optional(),
  })
  .superRefine((values, ctx) => {
    if (values.method !== "manual-transfer") return;

    if (!values.provider) {
      ctx.addIssue({
        code: "custom",
        path: ["provider"],
        message: "Choose which wallet you paid with.",
      });
    }
    if (!values.senderNumber) {
      ctx.addIssue({
        code: "custom",
        path: ["senderNumber"],
        message: "Add the number you sent the money from.",
      });
    }
    if (!values.transactionId) {
      ctx.addIssue({
        code: "custom",
        path: ["transactionId"],
        message: "Add the transaction ID from your payment confirmation.",
      });
    }
  });

/** `z.input` — what the form holds before defaults and transforms are applied. */
export type CheckoutValues = z.input<typeof checkoutSchema>;
export type CheckoutData = z.output<typeof checkoutSchema>;
export type ShippingAddress = z.infer<typeof shippingAddressSchema>;

/**
 * POST /orders.
 *
 * The cart travels in the body rather than being read from a server-side
 * session, because there isn't one — the cart is client state by design.
 * Note what is *not* here: any total. The server re-prices from scratch and
 * ignores whatever the client thinks the order costs; accepting a total would
 * make the shop's revenue a client-side value (§3.8).
 *
 * Idempotency travels as an `Idempotency-Key` header, not a body field —
 * it is a property of the request, not of the order, and a header keeps it out
 * of the schema every form has to satisfy.
 */
export const placeOrderRequestSchema = z.object({
  items: z.array(cartItemSchema).min(1, "Your basket is empty.").max(100),
  customer: checkoutSchema,
  couponCode: z.string().trim().min(1).max(64).optional(),
});

export type PlaceOrderRequest = z.infer<typeof placeOrderRequestSchema>;

export const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

export const checkoutDefaults: CheckoutValues = {
  fullName: "",
  email: "",
  phone: "",
  address: "",
  city: "",
  region: "inside-dhaka",
  method: "manual-transfer",
  senderNumber: "",
  transactionId: "",
  notes: "",
};

/** The fields a given method adds to the form. Drives the expanding panel. */
export function methodNeedsTransferDetails(method: PaymentMethod): boolean {
  return method === "manual-transfer";
}
