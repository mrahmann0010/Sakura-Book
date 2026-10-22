import { z } from "zod";
import { normaliseBdPhone } from "./bd-phone";
import { cleanTransactionId } from "./transaction-id";
import { cartItemSchema } from "./cart";
import { paymentProviders } from "./payment-verification";
import { ZONES_BY_ID } from "./shipping-zones";

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
  /**
   * A second number for the courier, when the first one does not answer.
   *
   * The delivery service's own manifest carries two — primary and secondary —
   * and this is the second one. Optional, because most orders have only one
   * number and a required field here would be filled with a copy of `phone`,
   * which is worse than an absent value: a courier reading the same number
   * twice has no fallback and no way to know it.
   *
   * Free text like `phone`, and normalised to E.164 at the point of sending
   * rather than here — see sms/phone.ts on why the stored form stays what the
   * customer typed.
   */
  secondaryPhone: z.string().trim().max(32).optional(),
  address: required("Add the street, house and area so the courier can find you."),
  city: required("Add the town or city."),
  /**
   * The delivery zone, by id from ./shipping-zones — the field postage is
   * priced off. Checked against that list here, at the boundary, so a
   * tampered value is a validation error rather than an order priced for
   * somewhere that does not exist.
   */
  zone: z
    .string()
    .trim()
    .min(1, "Choose your area so we can price delivery.")
    .refine((id) => ZONES_BY_ID.has(id), "Choose your area from the list."),
  /**
   * The tier's `delivery_regions` slug. Derived from `zone` by the server and
   * written onto the order, so anything a client sends here is ignored — it
   * stays in the schema only so an older client's payload still parses.
   */
  region: z.string().trim().optional(),

  /* ------------------------------------------------------------------------
     The address form's own fields, kept alongside the line it composes.

     `address` above is what the form joins these into, and it stays the
     customer-facing address — one string, rendered on the receipt and read by
     a courier. These are the same facts unjoined, and they exist because a
     courier manifest needs them apart: Pathao addresses a parcel as
     City → Zone → Area, which is district → upazila → area exactly.

     They were being recovered by splitting `address` back up, which does not
     work and cannot be made to. The join drops empty parts, so an order with
     no area and no upazila is indistinguishable from one where the line above
     the district is a house number — and that misread the detail line as the
     zone. Splitting a string to recover a structure we had in our hands is the
     bug; this is not having thrown it away.

     Optional, because every order placed before this shipped has none, and
     because the form does not require them. Absent means the exporter falls
     back to reading `address`, which is what it does for those orders anyway.
     ------------------------------------------------------------------------ */

  /**
   * Upazila / thana. Free text — see bd-geo.ts on why there is no list. Only
   * asked for outside Dhaka: inside it, the zone above already is the thana.
   */
  upazila: z.string().trim().max(120).optional(),
  /** Neighbourhood or village, below the upazila. */
  area: z.string().trim().max(120).optional(),
  /** Four digits, though not validated as such: people leave it off. */
  postCode: z.string().trim().max(16).optional(),
});

export const checkoutSchema = shippingAddressSchema
  .extend({
    method: z.enum(acceptedPaymentMethods),
    /* Transfer details are only asked for when the transfer option is open, so
       they are optional at the field level and required by the refinement. */
    /** Which wallet the transfer moved through — bKash, Rocket or Nagad. */
    provider: z.enum(paymentProviders).optional(),
    senderNumber: z.string().trim().optional(),
    /* Cleaned of a copied "TrxID" label before it is checked or stored — see
       cleanTransactionId. Only "TrxID" with nothing after it ends up empty,
       and the refinement below reports that as a missing ID. */
    transactionId: z.string().trim().transform(cleanTransactionId).optional(),
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
    } else if (!normaliseBdPhone(values.senderNumber)) {
      /* The gateway checks this against the paying wallet, so a typo here
         would stop the order confirming. Caught now, while the customer can
         still fix it. */
      ctx.addIssue({
        code: "custom",
        path: ["senderNumber"],
        message: "Enter the 11-digit wallet number you paid from, like 01XXXXXXXXX.",
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
  /**
   * Present when this checkout came from a waitlist invite link — spent
   * atomically with the order by WaitlistInviteService.consume(). A LOCKED
   * invite's `items` must include the book it reserved, at no more than the
   * copies it held; other titles ride along as ordinary purchases. See
   * CheckoutService.consumeInvite.
   */
  inviteToken: z.string().trim().min(1).optional(),
});

export type PlaceOrderRequest = z.infer<typeof placeOrderRequestSchema>;

export const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

export const checkoutDefaults: CheckoutValues = {
  fullName: "",
  email: "",
  phone: "",
  secondaryPhone: "",
  address: "",
  city: "",
  zone: "",
  method: "manual-transfer",
  senderNumber: "",
  transactionId: "",
  notes: "",
};

/** The fields a given method adds to the form. Drives the expanding panel. */
export function methodNeedsTransferDetails(method: PaymentMethod): boolean {
  return method === "manual-transfer";
}
