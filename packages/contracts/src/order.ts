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
export const orderCancelRequestSchema = z.object({
  orderNumber: z.string().trim().min(1, "Enter the order ID from your confirmation."),
  email: z.string().trim().email("Enter the email address you ordered with."),
  /**
   * Optional, and free text the customer typed. Stored on the status history
   * entry so the shop can read why orders are being dropped — which is the
   * whole operational value of letting people cancel rather than refuse at the
   * door. Capped because it lands in a note field, not a document store.
   */
  reason: z.string().trim().max(280).optional(),
});

export type OrderCancelRequest = z.infer<typeof orderCancelRequestSchema>;

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
  totalCents: z.number().int().nonnegative(),
  /** Snapshot of the code used, so the order reads correctly if it is later deleted. */
  couponCode: z.string().nullable(),

  paymentMethod: z.enum(paymentMethods),
  /** Which wallet a manual-transfer payment moved through. Null otherwise. */
  paymentProvider: z.enum(paymentProviders).nullable(),

  shipping: z.object({
    fullName: z.string(),
    address: z.string(),
    city: z.string(),
    region: z.string(),
    phone: z.string(),
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
