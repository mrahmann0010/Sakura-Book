import { derivePreOrderStatus, type PreOrder } from "@sakura/contracts";
import type { InferSelectModel } from "drizzle-orm";
import type { ShippingAddress } from "../db/schema";
import type { preOrderOrders } from "../db/schema";

export type PreOrderRow = InferSelectModel<typeof preOrderOrders>;

export function toPreOrderResponse(row: PreOrderRow): PreOrder {
  const address = row.shippingAddress as ShippingAddress;

  return {
    orderNumber: row.orderNumber,
    // One word for the customer, two columns for staff — the derivation is in
    // contracts so both apps read the lifecycle the same way.
    status: derivePreOrderStatus(row.paymentStatus, row.fulfillmentStatus),
    paymentStatus: row.paymentStatus,
    fulfillmentStatus: row.fulfillmentStatus,
    placedAt: row.createdAt.toISOString(),

    bookTitle: row.bookTitleSnapshot,
    authorName: row.authorNameSnapshot,
    quantity: row.quantity,
    unitPriceCents: row.unitPriceCents,
    subtotalCents: row.subtotalCents,
    totalCents: row.totalCents,

    customerName: row.customerName,
    customerEmail: row.customerEmail,
    customerPhone: row.customerPhone,
    shipping: {
      address: address.address,
      city: address.city,
      region: address.region,
    },
    note: row.customerNote,
  };
}
