import type { AdminPreOrderDetail, AdminPreOrderSummary, PaymentMethod } from "@sakura/contracts";
import type { ShippingAddress } from "../../db/schema";
import {
  PRE_ORDER_FULFILLMENT_TRANSITIONS,
  PRE_ORDER_PAYMENT_TRANSITIONS,
  canStartFulfillment,
  toPreOrderResponse,
  type PreOrderRow,
} from "../../pre-orders";

/**
 * Rows → the admin wire shapes.
 *
 * The detail mapper builds on `toPreOrderResponse` rather than rebuilding a
 * pre-order from the same columns — the rule admin-order.mapper.ts states for
 * itself, and for the same reason: two hand-written readings of one order is
 * how the total on the admin page comes to disagree with the total on the
 * customer's confirmation, discovered by a customer quoting a figure the staff
 * member cannot find.
 */

export function toAdminPreOrderSummary(row: PreOrderRow): AdminPreOrderSummary {
  const address = row.shippingAddress as ShippingAddress;

  return {
    orderNumber: row.orderNumber,
    paymentStatus: row.paymentStatus,
    fulfillmentStatus: row.fulfillmentStatus,
    placedAt: row.createdAt.toISOString(),
    customerName: row.customerName,
    customerEmail: row.customerEmail,
    customerPhone: row.customerPhone,
    region: address.region,
    paymentMethod: row.paymentMethod as PaymentMethod,
    bookTitle: row.bookTitleSnapshot,
    quantity: row.quantity,
    currency: CURRENCY_OF_RECORD,
    totalCents: row.totalCents,
    hasPaymentReference: Boolean(row.transactionId?.trim() || row.senderNumber?.trim()),
    hasInternalNote: Boolean(row.internalNote?.trim()),
  };
}

export function toAdminPreOrderDetail(row: PreOrderRow): AdminPreOrderDetail {
  const customerView = toPreOrderResponse(row);

  /**
   * The cross-track rule is applied here, not just in the service, so the
   * panel never draws a button the API will refuse. Cancelling survives the
   * filter deliberately — an unverified pre-order is exactly the kind that
   * gets cancelled. See `canStartFulfillment`.
   */
  const fulfillmentMoves = PRE_ORDER_FULFILLMENT_TRANSITIONS[row.fulfillmentStatus].filter(
    (next) => next === "CANCELLED" || canStartFulfillment(row.paymentStatus),
  );

  return {
    ...customerView,

    paymentMethod: row.paymentMethod as PaymentMethod,
    senderNumber: row.senderNumber,
    transactionId: row.transactionId,
    internalNote: row.internalNote,

    allowedPaymentTransitions: [...PRE_ORDER_PAYMENT_TRANSITIONS[row.paymentStatus]],
    allowedFulfillmentTransitions: [...fulfillmentMoves],
  };
}

/** See the note on the same constant in orders/order.mapper.ts. */
const CURRENCY_OF_RECORD = "BDT";
