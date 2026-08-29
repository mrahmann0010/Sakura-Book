import type {
  AdminOrderDetail,
  AdminOrderSummary,
  AdminOrderVerificationState,
  AdminPayment,
  PaymentMethod,
  PaymentProvider,
  PaymentVerificationRecord,
  ReceiptUniqueness,
} from "@sakura/contracts";
import type { InferSelectModel } from "drizzle-orm";
import type { orders, payments, ShippingAddress } from "../../db/schema";
import {
  ORDER_STATUS_TRANSITIONS,
  releasesStock,
  toOrderResponse,
  type OrderRow,
} from "../../orders";

/**
 * Rows → the admin wire shapes.
 *
 * The detail mapper builds on `toOrderResponse` rather than rebuilding an
 * order from the same columns. That is the same rule the customer-facing
 * mapper states for itself: two hand-written readings of one order is how the
 * totals on the admin page and the totals on the customer's receipt come to
 * disagree — and here that divergence would be discovered by a customer
 * quoting a number the staff member cannot find.
 */

type OrderListRow = Pick<
  InferSelectModel<typeof orders>,
  | "orderNumber"
  | "status"
  | "createdAt"
  | "customerName"
  | "customerEmail"
  | "customerPhone"
  | "shippingAddress"
  | "paymentMethod"
  | "provider"
  | "totalCents"
  | "internalNote"
  // Not rendered, and never sent: the receipt is what the uniqueness badge is
  // computed from, not something the queue displays.
  | "transactionIdNormalised"
>;

/**
 * Which of the four uniqueness states an order is in.
 *
 * Derived from the row plus one page-wide set of duplicated receipts, so a
 * list of fifty orders costs one extra query rather than fifty. The order of
 * the checks matters: cash on delivery is answered before the receipt is
 * examined at all, because "no receipt" is only a finding for a method that
 * should have one.
 */
export function receiptUniquenessOf(
  row: { paymentMethod: string; transactionIdNormalised: string | null },
  duplicatedReceipts: ReadonlySet<string>,
  claimedByOrderNumber: string | null = null,
): ReceiptUniqueness {
  if (row.paymentMethod !== "manual-transfer") {
    return { state: "NOT_APPLICABLE", claimedByOrderNumber: null };
  }

  const receipt = row.transactionIdNormalised;

  // Null for cash on delivery, for orders placed before the receipt columns
  // existed, and for a receipt that was pure punctuation. All three are the
  // same finding for staff: there is nothing here to check.
  if (!receipt) return { state: "MISSING", claimedByOrderNumber: null };

  if (duplicatedReceipts.has(receipt)) {
    return { state: "DUPLICATE", claimedByOrderNumber };
  }

  return { state: "UNIQUE", claimedByOrderNumber: null };
}

export function toAdminOrderSummary(
  row: OrderListRow,
  counts: { lineCount: number; itemCount: number } | undefined,
  receipt: ReceiptUniqueness,
  verification: AdminOrderVerificationState,
): AdminOrderSummary {
  return {
    orderNumber: row.orderNumber,
    status: row.status,
    placedAt: row.createdAt.toISOString(),
    customerName: row.customerName,
    customerEmail: row.customerEmail,
    customerPhone: row.customerPhone,
    region: (row.shippingAddress as ShippingAddress).region,
    city: (row.shippingAddress as ShippingAddress).city,
    paymentMethod: row.paymentMethod as PaymentMethod,
    paymentProvider: row.provider as PaymentProvider | null,
    currency: CURRENCY_OF_RECORD,
    totalCents: row.totalCents,
    // Absent from the counts map means an order with no items, which should be
    // impossible — checkout rejects an empty cart — but a list view is the
    // wrong place to discover that, so it renders as zero rather than throwing.
    lineCount: counts?.lineCount ?? 0,
    itemCount: counts?.itemCount ?? 0,
    /**
     * A flag, not the note. The queue shows a marker so staff know to open the
     * order; sending every internal note in a fifty-row list would put
     * staff-only text into a response rendered as a table, which is how it
     * ends up in a screenshot.
     */
    hasInternalNote: Boolean(row.internalNote?.trim()),

    receipt,
    verification,
  };
}

export function toAdminOrderDetail(
  row: OrderRow,
  paymentRows: InferSelectModel<typeof payments>[],
  receipt: ReceiptUniqueness,
  verification: AdminOrderVerificationState,
  verifications: PaymentVerificationRecord[],
): AdminOrderDetail {
  const customerView = toOrderResponse(row);

  return {
    ...customerView,

    customerEmail: row.customerEmail,
    customerNote: row.customerNote,
    internalNote: row.internalNote,

    senderNumber: row.senderNumber,
    transactionId: row.transactionId,

    payments: paymentRows.map(toAdminPayment),

    /**
     * Read off the machine at request time rather than stored. The lifecycle
     * is code, so a transition table that changed in a deploy takes effect on
     * the next page load — a persisted copy would need a backfill and would be
     * wrong in the window before it ran.
     */
    allowedTransitions: [...ORDER_STATUS_TRANSITIONS[row.status]],

    /**
     * Computed against CANCELLED specifically. REFUNDED releases stock from
     * exactly the same statuses, so one boolean answers for both — asserted in
     * the machine's own tests rather than assumed here.
     */
    releasesStockOnCancel: releasesStock(row.status, "CANCELLED"),

    receipt,
    verification,
    verifications,
  };
}

function toAdminPayment(row: InferSelectModel<typeof payments>): AdminPayment {
  return {
    provider: row.provider,
    referenceId: row.providerReferenceId,
    amountCents: row.amountCents,
    status: row.status,
    recordedAt: row.createdAt.toISOString(),
  };
}

/** See the note on the same constant in orders/order.mapper.ts. */
const CURRENCY_OF_RECORD = "BDT";
