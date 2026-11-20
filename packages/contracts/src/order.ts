import { z } from "zod";
import { paymentMethods } from "./checkout";
import { paymentProviders } from "./payment-verification";

/* --------------------------------------------------------------------------
   Orders — confirmation, and guest lookup.
   -------------------------------------------------------------------------- */

export const orderStatuses = [
  "PENDING",
  "PAYMENT_CONFIRMED",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
] as const;

export type OrderStatus = (typeof orderStatuses)[number];

/**
 * Where an order's money is — kept apart from `orderStatuses`, which say where
 * the order is.
 *
 * The two used to be one field, and for a prepaid order they move together:
 * the money arrives, then the parcel is packed. Cash on delivery breaks that —
 * the parcel is packed and shipped while unpaid, and the money arrives after
 * DELIVERED, then again when the courier settles. One field cannot say
 * "shipped, unpaid" or "delivered, cash still with Pathao", so this one does.
 *
 * - `UNPAID` — nothing received yet. Every order starts here.
 * - `PAID` — a prepaid order's payment was verified.
 * - `COLLECTED` — a COD parcel was delivered; the courier holds the cash.
 * - `REMITTED` — the courier paid the shop for a COD parcel.
 * - `REFUNDED` — the money went back to the customer.
 *
 * See docs/cod-orders.md §3 for the design and the migration plan.
 */
export const orderPaymentStatuses = [
  "UNPAID",
  "PAID",
  "COLLECTED",
  "REMITTED",
  "REFUNDED",
] as const;

export type OrderPaymentStatus = (typeof orderPaymentStatuses)[number];

/* --------------------------------------------------------------------------
   Cash-on-delivery confirmation (docs/cod-orders.md).

   A COD order waits in PENDING until the customer messages the shop's Facebook
   page and staff approve it. These are the shared pieces of that flow.
   -------------------------------------------------------------------------- */

/**
 * How long a COD order waits for the customer to get in touch before it is
 * cancelled and its copies go back on the shelf. Shown to the customer on the
 * confirmation screen; the expiry job that enforces it is Step 2.
 */
export const COD_CONFIRMATION_HOURS = 48;

/** How the customer reached the shop to confirm — recorded on approval. */
export const codConfirmationChannels = ["FACEBOOK", "PHONE", "OTHER"] as const;

export type CodConfirmationChannel = (typeof codConfirmationChannels)[number];

/**
 * Lookup by any one of order number, email, or phone — deliberately
 * single-factor, so a customer who has forgotten their order ID can still
 * find it. Giving the order number returns that one order; giving email
 * and/or phone returns every order matching either one, since a returning
 * customer may have placed more than one. At least one field is required.
 *
 * This is a real trade against the two-factor design cancel() still uses
 * below: anyone who knows a customer's phone or email can see their order
 * history. `StrictThrottle` stays on the route as scraping resistance, and a
 * miss is always an empty list — never a signal about which field, if any,
 * came close.
 */
export const orderLookupRequestSchema = z
  .object({
    orderNumber: z.string().trim().min(1).optional(),
    email: z.string().trim().email().optional(),
    phone: z.string().trim().min(1).optional(),
  })
  .refine((value) => value.orderNumber || value.email || value.phone, {
    message: "Enter your order ID, email, or phone number.",
  });

/**
 * Cancelling an order.
 *
 * Its own schema, not built on the (now single-factor) lookup schema above:
 * this one writes, so it keeps the stronger two-factor requirement — order
 * number *and* a matching email, exactly as lookup used to work. A mismatch
 * returns NOT_FOUND, never 403 — a "wrong email" response would confirm the
 * order number is real and turn this into an enumeration oracle.
 */
const orderCancelFields = z.object({
  orderNumber: z.string().trim().min(1, "Enter the order ID from your confirmation."),
  /**
   * The second factor: the email *or* the phone the order was placed with.
   * Phone because email is optional at checkout — an order without one would
   * otherwise be uncancellable, or worse, matched by an empty string.
   */
  email: z.string().trim().email("Enter the email address you ordered with.").optional(),
  phone: z.string().trim().min(1).optional(),
  /**
   * Optional, and free text the customer typed. Stored on the status history
   * entry so the shop can read why orders are being dropped — which is the
   * whole operational value of letting people cancel rather than refuse at the
   * door. Capped because it lands in a note field, not a document store.
   */
  reason: z.string().trim().max(280).optional(),
});

export const orderCancelRequestSchema = orderCancelFields.refine(
  (value) => value.email || value.phone,
  { message: "Enter the email or phone number you ordered with." },
);

export type OrderCancelRequest = z.infer<typeof orderCancelRequestSchema>;

/**
 * Asking whether a just-placed order's payment has been confirmed yet.
 *
 * The checkout's "payment is being checked" modal polls this while the
 * background worker retries the claim. Two factors, like cancel, because it
 * is polled and so gets a looser rate limit than single-factor lookup.
 */
export const orderPaymentStatusRequestSchema = orderCancelFields
  .pick({ orderNumber: true, email: true, phone: true })
  .refine((value) => value.email || value.phone, {
    message: "Enter the email or phone number you ordered with.",
  });

export type OrderPaymentStatusRequest = z.infer<typeof orderPaymentStatusRequestSchema>;

/**
 * A line as frozen onto the order.
 *
 * Title, authors and unit price are snapshots, not joins: a historical order
 * must render as it was bought, so a later price change or a retitled edition
 * cannot rewrite it. That is why these repeat fields that also exist on the
 * book — they are not denormalisation for speed.
 */
export const orderLineSchema = z.object({
  bookId: z.string().uuid().nullable(),
  slug: z.string().nullable(),
  title: z.string(),
  authors: z.array(z.string()),
  coverImageUrl: z.string().nullable(),
  quantity: z.number().int().positive(),
  unitPriceCents: z.number().int().nonnegative(),
  lineTotalCents: z.number().int().nonnegative(),
});

export const orderStatusEventSchema = z.object({
  status: z.enum(orderStatuses),
  occurredAt: z.string(),
  /** Operator-supplied context ("handed to courier"). Not always present. */
  note: z.string().nullable(),
});

export const orderSchema = z.object({
  /**
   * The human-quotable id — eight characters, like MG-40718, as the
   * confirmation copy promises. The UUID primary key is never exposed:
   * customers read this over the phone.
   */
  orderNumber: z.string(),
  status: z.enum(orderStatuses),
  placedAt: z.string(),

  currency: z.string().length(3),
  lines: z.array(orderLineSchema),

  subtotalCents: z.number().int().nonnegative(),
  deliveryCents: z.number().int().nonnegative(),
  discountCents: z.number().int().nonnegative(),
  /** The cash-on-delivery charge (./cod-fee). Zero for prepaid orders. */
  codFeeCents: z.number().int().nonnegative().default(0),
  totalCents: z.number().int().nonnegative(),
  /** Snapshot of the code used, so the order reads correctly if it is later deleted. */
  couponCode: z.string().nullable(),

  paymentMethod: z.enum(paymentMethods),
  /** Where the money is, independent of `status`. See `orderPaymentStatuses`. */
  paymentStatus: z.enum(orderPaymentStatuses),
  /** Which wallet a manual-transfer payment moved through. Null otherwise. */
  paymentProvider: z.enum(paymentProviders).nullable(),
  /**
   * The number the customer sent the transfer from. Null on cash on delivery,
   * and on any transfer placed before the field was collected.
   *
   * Exposed for the downloadable receipt, which names the method and the
   * paying number so the sheet is worth something as proof. The transaction
   * ID deliberately stays server-side: lookup is single-factor (see
   * orderLookupRequestSchema), and a payment reference is the one field on
   * this order that could be replayed against the gateway by whoever reads
   * it. The sending number is already the customer's own, and in almost every
   * order is the same number `shipping.phone` already carries.
   *
   * Defaulted rather than merely nullable, so an absent field parses instead
   * of throwing. The web validates every order response against this schema
   * and turns a failure into an ApiContractError (see apiFetch), which means
   * a required field here would break checkout outright for as long as a
   * newly-deployed web was talking to an API that had not shipped yet. The
   * API and the web deploy separately, so that window is real; a default
   * makes the field additive and removes the ordering constraint.
   */
  paymentSenderNumber: z.string().nullable().default(null),

  shipping: z.object({
    fullName: z.string(),
    address: z.string(),
    city: z.string(),
    region: z.string(),
    phone: z.string(),
    /** The courier's second number. Null on every order placed without one. */
    secondaryPhone: z.string().nullable(),
  }),

  /**
   * The full timeline, not just the current status. order_status_history is
   * the source of truth and `orders.status` is a read cache (§3.11), so the
   * tracking page renders from this.
   */
  timeline: z.array(orderStatusEventSchema),
});

/** Zero, one, or many matches — see orderLookupRequestSchema. */
export const orderLookupResponseSchema = z.array(orderSchema);

export type OrderLookupRequest = z.infer<typeof orderLookupRequestSchema>;
export type OrderLine = z.infer<typeof orderLineSchema>;
export type OrderStatusEvent = z.infer<typeof orderStatusEventSchema>;
export type Order = z.infer<typeof orderSchema>;
export type OrderLookupResponse = z.infer<typeof orderLookupResponseSchema>;
