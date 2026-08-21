import { z } from "zod";
import { shippingAddressSchema } from "./checkout";

/* --------------------------------------------------------------------------
   Placing a pre-order.

   Mirrors placeOrderRequestSchema in ./checkout, simplified: one book, one
   quantity, no coupon, no payment method — see pre_order_orders in the API
   schema for why. `customer` reuses `shippingAddressSchema` rather than the
   full `checkoutSchema`, since a pre-order has no payment-method step.
   -------------------------------------------------------------------------- */

export const placePreOrderRequestSchema = z.object({
  preOrderBookId: z.string().uuid(),
  quantity: z.number().int().positive().max(99),
  customer: shippingAddressSchema,
  note: z.string().trim().max(500, "Keep the note under 500 characters.").optional(),
});

export type PlacePreOrderRequest = z.infer<typeof placePreOrderRequestSchema>;

export const preOrderStatuses = ["PENDING", "CONFIRMED", "CANCELLED"] as const;
export type PreOrderStatus = (typeof preOrderStatuses)[number];

/**
 * The confirmation the customer sees. Same idea as `Order` in ./order — a
 * frozen snapshot of what was pre-ordered and for how much, plus its status.
 */
export const preOrderSchema = z.object({
  orderNumber: z.string(),
  status: z.enum(preOrderStatuses),
  placedAt: z.string(),

  bookTitle: z.string(),
  authorName: z.string(),
  quantity: z.number().int().positive(),
  unitPriceCents: z.number().int().nonnegative(),
  subtotalCents: z.number().int().nonnegative(),
  totalCents: z.number().int().nonnegative(),

  customerName: z.string(),
  customerEmail: z.string(),
  customerPhone: z.string(),
  shipping: z.object({
    address: z.string(),
    city: z.string(),
    region: z.string(),
  }),
  note: z.string().nullable(),
});

export type PreOrder = z.infer<typeof preOrderSchema>;
