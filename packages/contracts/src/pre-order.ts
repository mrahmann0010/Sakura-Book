import { z } from "zod";
import { methodNeedsTransferDetails, shippingAddressSchema, type PaymentMethod } from "./checkout";

/* --------------------------------------------------------------------------
   Placing a pre-order.

   Mirrors placeOrderRequestSchema in ./checkout, simplified: one book, one
   quantity, no coupon — see pre_order_orders in the API schema for why.
   `customer` reuses `shippingAddressSchema` rather than the full
   `checkoutSchema`, since a pre-order's payment step is its own, smaller
   thing (below) rather than the real checkout's.
   -------------------------------------------------------------------------- */

/**
 * Pre-orders are prepaid only: there is no physical stock yet for a courier
 * to collect cash against, so `cash-on-delivery` is left commented out here
 * rather than deleted — the same way `card` stays in `paymentMethods` (see
 * ./checkout) as a visible-but-disabled option instead of being removed.
 * Re-enabling COD for pre-orders, if that ever makes sense, is uncommenting
 * one line.
 */
export const preOrderPaymentMethods = [
  // "cash-on-delivery",
  "manual-transfer",
] as const satisfies readonly PaymentMethod[];
export type PreOrderPaymentMethod = (typeof preOrderPaymentMethods)[number];

export const placePreOrderRequestSchema = z
  .object({
    preOrderBookId: z.string().uuid(),
    quantity: z.number().int().positive().max(99),
    customer: shippingAddressSchema,
    method: z.enum(preOrderPaymentMethods),
    /* Transfer details are only asked for when manual-transfer is chosen, so
       they are optional at the field level and required by the refinement —
       same shape as checkoutSchema in ./checkout. */
    senderNumber: z.string().trim().optional(),
    transactionId: z.string().trim().optional(),
    note: z.string().trim().max(500, "Keep the note under 500 characters.").optional(),
  })
  .superRefine((values, ctx) => {
    if (!methodNeedsTransferDetails(values.method)) return;

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
