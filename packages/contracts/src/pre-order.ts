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

/**
 * A pre-order moves along two independent tracks, and the reason is the gap
 * between them: payment is verified within a day of the order being placed,
 * while the book itself does not physically exist until the print run lands
 * months later. One column cannot say "paid and accepted, waiting for print"
 * — it has to pick a side, and whichever it picks the other question has no
 * answer.
 *
 * `preOrderPaymentStatuses` is the acceptance track: someone read the bKash
 * transaction ID off the order and decided.
 */
export const preOrderPaymentStatuses = ["PENDING", "ACCEPTED", "REJECTED", "REFUNDED"] as const;
export type PreOrderPaymentStatus = (typeof preOrderPaymentStatuses)[number];

/**
 * The delivery track. Every pre-order sits in NOT_STARTED — usually for
 * months — until there are copies to pick, which is why that is the default
 * rather than a PENDING that would read as "something is late".
 */
export const preOrderFulfillmentStatuses = [
  "NOT_STARTED",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
] as const;
export type PreOrderFulfillmentStatus = (typeof preOrderFulfillmentStatuses)[number];

/**
 * The single answer to "where is my pre-order", derived from the two tracks
 * above rather than stored — see `derivePreOrderStatus`.
 *
 * Customers get one status because they asked one question. Staff get both
 * columns, because theirs are two different jobs done by two different people
 * at two different times.
 */
export const preOrderStatuses = [
  "PENDING",
  "CONFIRMED",
  "REJECTED",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
] as const;
export type PreOrderStatus = (typeof preOrderStatuses)[number];

/**
 * Two tracks → the one word the customer sees.
 *
 * Order matters here. A cancelled or rejected pre-order reports that whatever
 * else is true of it, because "cancelled" is the answer that changes what the
 * customer does next. Below that, fulfilment outranks payment once it has
 * actually started: an order that is out with the courier is SHIPPED, and
 * repeating that its payment was accepted weeks ago tells nobody anything.
 *
 * Lives in contracts, not in the API, so the storefront can derive the same
 * word from an admin payload without a second, drifting copy of the rule.
 */
export function derivePreOrderStatus(
  paymentStatus: PreOrderPaymentStatus,
  fulfillmentStatus: PreOrderFulfillmentStatus,
): PreOrderStatus {
  if (fulfillmentStatus === "CANCELLED") return "CANCELLED";
  if (paymentStatus === "REJECTED") return "REJECTED";
  if (paymentStatus === "REFUNDED") return "CANCELLED";

  if (fulfillmentStatus !== "NOT_STARTED") return fulfillmentStatus;

  return paymentStatus === "ACCEPTED" ? "CONFIRMED" : "PENDING";
}

/**
 * The confirmation the customer sees. Same idea as `Order` in ./order — a
 * frozen snapshot of what was pre-ordered and for how much, plus its status.
 */
export const preOrderSchema = z.object({
  orderNumber: z.string(),
  /** Derived from the two tracks below; never stored. See derivePreOrderStatus. */
  status: z.enum(preOrderStatuses),
  paymentStatus: z.enum(preOrderPaymentStatuses),
  fulfillmentStatus: z.enum(preOrderFulfillmentStatuses),
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
