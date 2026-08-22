import type {
  Order,
  OrderLine,
  OrderStatusEvent,
  PaymentMethod,
  PaymentProvider,
} from "@sakura/contracts";
import type { InferSelectModel } from "drizzle-orm";
import type { orderItems, orders, orderStatusHistory } from "../db/schema";
import type { ShippingAddress } from "../db/schema";

/**
 * The rows a full order response is built from.
 *
 * `book` is a live join and everything else is a snapshot, which is the whole
 * design in one type: slug and cover image are addressing and decoration, so
 * they may follow the catalog and may go null when a title is delisted. Title,
 * authors and unit price never do — they are what the customer bought and what
 * they were charged, and a later price change must not rewrite a receipt.
 */
export type OrderRow = InferSelectModel<typeof orders> & {
  items: (InferSelectModel<typeof orderItems> & {
    book: { slug: string; coverImageUrl: string } | null;
  })[];
  statusHistory: InferSelectModel<typeof orderStatusHistory>[];
};

/**
 * Database rows → the wire contract.
 *
 * One mapper, shared by order creation and order lookup, because a customer
 * who reloads their confirmation page must see the same object the POST
 * returned. Two hand-written response shapes is how "the total changed after I
 * refreshed" bugs happen.
 *
 * Note what is not copied out: `id`, `couponId`, `internalNote`,
 * `idempotencyKey`. The UUID stays private because `orderNumber` is the public
 * handle, and the internal note is staff-only by definition.
 */
export function toOrderResponse(row: OrderRow): Order {
  const address = row.shippingAddress as ShippingAddress;

  return {
    orderNumber: row.orderNumber,
    status: row.status,
    placedAt: row.createdAt.toISOString(),

    // Read off the order rather than from config: a historical order was
    // priced in whatever currency the shop used that day, and the fact that
    // there is only one today is not a reason to derive it.
    currency: CURRENCY_OF_RECORD,
    lines: row.items.map(toOrderLine),

    subtotalCents: row.subtotalCents,
    deliveryCents: row.shippingCents,
    discountCents: row.discountCents,
    totalCents: row.totalCents,
    couponCode: row.discountCodeSnapshot,

    paymentMethod: row.paymentMethod as PaymentMethod,
    paymentProvider: row.provider as PaymentProvider | null,

    shipping: {
      fullName: row.customerName,
      address: address.address,
      city: address.city,
      region: address.region,
      phone: row.customerPhone,
    },

    // Ascending: the timeline reads top-down as the order progressed, and the
    // append-only history is the source of truth for it — `orders.status` is a
    // read cache and is deliberately not what this is derived from (§3.11).
    timeline: [...row.statusHistory]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(toStatusEvent),
  };
}

/**
 * There is one currency and no column for it yet, so this is a constant with a
 * name that says what it is standing in for. When multi-currency arrives it
 * becomes `orders.currency`, frozen at checkout like every other money field —
 * which is why this is not read from ShippingConfig: config is what the shop
 * charges *now*, and an order is what it charged *then*.
 */
const CURRENCY_OF_RECORD = "BDT";

function toOrderLine(item: OrderRow["items"][number]): OrderLine {
  return {
    bookId: item.bookId,
    slug: item.book?.slug ?? null,
    title: item.bookTitleSnapshot,
    authors: item.authorNamesSnapshot,
    coverImageUrl: item.book?.coverImageUrl ?? null,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    // Derived, not stored. The multiplication is exact in integer cents, so a
    // stored line total could only ever be a second copy of the same number
    // with an opportunity to disagree.
    lineTotalCents: item.unitPriceCents * item.quantity,
  };
}

function toStatusEvent(event: InferSelectModel<typeof orderStatusHistory>): OrderStatusEvent {
  return {
    status: event.status,
    occurredAt: event.createdAt.toISOString(),
    note: event.note,
  };
}
