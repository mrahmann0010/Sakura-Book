import type { PreOrder } from "@sakura/contracts";
import type { InferSelectModel } from "drizzle-orm";
import type { ShippingAddress } from "../db/schema";
import type { preOrderOrders } from "../db/schema";

export type PreOrderRow = InferSelectModel<typeof preOrderOrders>;

export function toPreOrderResponse(row: PreOrderRow): PreOrder {
  const address = row.shippingAddress as ShippingAddress;

  return {
    orderNumber: row.orderNumber,
    status: row.status,
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
