import { z } from "zod";
import { paymentMethods } from "./checkout";

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
 * Lookup is authenticated by possession of the order number *plus* a matching
 * email. A mismatch returns NOT_FOUND, never 403 — a "wrong email" response
 * would confirm the order number is real and turn this into an enumeration
 * oracle. POST rather than GET so the email stays out of URLs and access logs.
 */
export const orderLookupRequestSchema = z.object({
  orderNumber: z.string().trim().min(1, "Enter the order ID from your confirmation."),
  email: z.string().trim().email("Enter the email address you ordered with."),
});

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

export type OrderLookupRequest = z.infer<typeof orderLookupRequestSchema>;
export type OrderLine = z.infer<typeof orderLineSchema>;
export type OrderStatusEvent = z.infer<typeof orderStatusEventSchema>;
export type Order = z.infer<typeof orderSchema>;
