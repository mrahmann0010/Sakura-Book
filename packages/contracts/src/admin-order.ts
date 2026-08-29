import { z } from "zod";
import { divisionSlugs } from "./bd-geo";
import { paymentMethods } from "./checkout";
import { orderSchema, orderStatuses } from "./order";
import { paginated, pageQuerySchema } from "./pagination";
import {
  paymentProviders,
  paymentVerificationOutcomes,
  paymentVerificationRecordSchema,
} from "./payment-verification";

/* --------------------------------------------------------------------------
   Order operations, as staff see them.

   The storefront's `Order` is what a customer may see. Everything added here
   is either staff-only (the internal note, the payment attempts, the email
   address on a list row) or a decision aid the panel needs to render controls
   correctly (`allowedTransitions`). The two shapes share `orderSchema` rather
   than being written twice, so a field added to the customer's receipt cannot
   go missing from the admin view.
   -------------------------------------------------------------------------- */

/**
 * How the order list is sorted. Newest-first by default, because the admin
 * list is a work queue and the work arrives at the top.
 *
 * `oldest` is not a mirror-image nicety — it is how you find the order that
 * has been sitting in PENDING for nine days, which is the one that actually
 * needs attention.
 */
export const adminOrderSorts = ["recent", "oldest", "total-desc"] as const;

export type AdminOrderSort = (typeof adminOrderSorts)[number];

/**
 * Filters for the order queue.
 *
 * `status` is repeatable, so "everything still to be fulfilled" is one query
 * rather than three: `?status=PAYMENT_CONFIRMED&status=PROCESSING`. A single
 * status would force the panel to either fetch three pages and merge them —
 * which breaks pagination and totals — or offer only one tab at a time.
 */
export const adminOrderQuerySchema = pageQuerySchema({ defaultPageSize: 25 }).extend({
  /**
   * `preprocess` because a repeated query parameter arrives as a string when
   * given once and an array when given twice, and a schema that only accepts
   * one of those breaks in whichever case the developer did not test.
   */
  status: z
    .preprocess(
      (value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]),
      z.array(z.enum(orderStatuses)),
    )
    .optional(),

  paymentMethod: z.enum(paymentMethods).optional(),

  /**
   * Destination division, as a slug from `bdDivisions`.
   *
   * Matched against the districts that division contains, because an order
   * records the district it is going to and never the division itself — see
   * bd-geo.ts. Orders whose stored district is not in the list (an address
   * typed before the cascading picker existed) match no division and are
   * reachable only with the filter off, which is the honest answer: nothing
   * on the order says where it belongs.
   */
  division: z.enum(divisionSlugs).optional(),

  /**
   * Free text over order number, customer name, email and phone.
   *
   * One box rather than four fields, because the staff member searching has
   * exactly one identifier to hand — whatever the customer said on the phone —
   * and does not know which column it lives in.
   */
  q: z.string().trim().min(1).max(120).optional(),

  /** Inclusive date bounds on when the order was placed. ISO-8601 dates. */
  placedFrom: z.iso.date().optional(),
  placedTo: z.iso.date().optional(),

  sort: z.enum(adminOrderSorts).default("recent"),
});

export type AdminOrderQuery = z.infer<typeof adminOrderQuerySchema>;

/**
 * One row in the queue.
 *
 * Deliberately not the full order. A list of fifty orders each carrying its
 * lines and its whole status timeline is a response measured in hundreds of
 * kilobytes to render a table that shows none of it.
 */
/**
 * Whether this order's receipt is its own.
 *
 * Separate from the gateway verification below, and deliberately not merged
 * into one "verified" badge, because the two are independent and the dangerous
 * case is exactly where they disagree: a reused receipt is *genuine* at the
 * gateway — it is a real payment, of the right amount, that another order has
 * already been granted against. A single combined badge would render that as
 * "verified" and hide the only thing wrong with it.
 *
 * - UNIQUE — no other live order holds this receipt.
 * - DUPLICATE — another live order does, and `claimedByOrderNumber` names it.
 * - MISSING — a manual transfer with no receipt on file. Historic orders
 *   placed before the columns existed land here, as does anything whose
 *   receipt was pure punctuation.
 * - NOT_APPLICABLE — cash on delivery. There is no receipt to be unique.
 */
export const receiptUniquenessStates = [
  "UNIQUE",
  "DUPLICATE",
  "MISSING",
  "NOT_APPLICABLE",
] as const;
export type ReceiptUniquenessState = (typeof receiptUniquenessStates)[number];

export const receiptUniquenessSchema = z.object({
  state: z.enum(receiptUniquenessStates),
  /** Set only on DUPLICATE — the order that claimed the receipt first. */
  claimedByOrderNumber: z.string().nullable(),
});

export type ReceiptUniqueness = z.infer<typeof receiptUniquenessSchema>;

/**
 * The last gateway cross-check, or that there has never been one.
 *
 * `UNCHECKED` is a real state and the most important one on this list: it is
 * how an order that was confirmed on trust becomes visible afterwards. Every
 * other value comes from `paymentVerificationOutcomes`.
 */
export const adminOrderVerificationStateSchema = z.object({
  outcome: z.union([z.enum(paymentVerificationOutcomes), z.literal("UNCHECKED")]),
  checkedAt: z.string().datetime().nullable(),
  /** Null for the automatic check that runs at checkout. */
  checkedByEmail: z.string().nullable(),
});

export type AdminOrderVerificationState = z.infer<typeof adminOrderVerificationStateSchema>;

export const adminOrderSummarySchema = z.object({
  orderNumber: z.string(),
  status: z.enum(orderStatuses),
  placedAt: z.string().datetime(),
  customerName: z.string(),
  customerEmail: z.string(),
  customerPhone: z.string(),
  region: z.string(),
  /**
   * The destination district, straight off the frozen shipping address.
   *
   * On the summary because a list filtered by division has to show which part
   * of it each row is in — "Sylhet division" is eight orders across four
   * districts, and a parcel is addressed to a district, not to a division.
   */
  city: z.string(),
  paymentMethod: z.enum(paymentMethods),
  paymentProvider: z.enum(paymentProviders).nullable(),
  currency: z.string().length(3),
  totalCents: z.number().int().nonnegative(),
  /** Distinct titles, and total copies — enough to size a pick list at a glance. */
  lineCount: z.number().int().nonnegative(),
  itemCount: z.number().int().nonnegative(),
  hasInternalNote: z.boolean(),

  /**
   * The two payment-safety indicators, on the queue row itself.
   *
   * On the summary and not only the detail, which is the point of them: a
   * duplicate receipt that is only visible after opening an order is a
   * duplicate nobody sees on a busy morning. The transaction ID itself stays
   * off this schema — the badge is the finding, and the receipt number is not
   * something to spray across a list view.
   */
  receipt: receiptUniquenessSchema,
  verification: adminOrderVerificationStateSchema,
});

export type AdminOrderSummary = z.infer<typeof adminOrderSummarySchema>;

export const adminOrderListSchema = paginated(adminOrderSummarySchema);

export type AdminOrderList = z.infer<typeof adminOrderListSchema>;

/** A recorded payment attempt against an order. */
export const adminPaymentSchema = z.object({
  provider: z.string(),
  referenceId: z.string().nullable(),
  amountCents: z.number().int(),
  status: z.enum(["PENDING", "SUCCEEDED", "FAILED", "REFUNDED"]),
  recordedAt: z.string().datetime(),
});

export type AdminPayment = z.infer<typeof adminPaymentSchema>;

/**
 * The full order, for the detail page.
 *
 * Built from `orderSchema` so the lines, totals and timeline are literally the
 * customer's view, plus what staff need and customers must not see.
 */
export const adminOrderDetailSchema = orderSchema.extend({
  customerEmail: z.string(),
  /** What the customer typed at checkout ("leave at the gate"). */
  customerNote: z.string().nullable(),
  /** Staff-only. Never returned by any storefront endpoint. */
  internalNote: z.string().nullable(),

  /**
   * The manual-transfer receipt the customer gave at checkout: the wallet the
   * money came from, and the transaction ID on their confirmation.
   *
   * Both null for cash on delivery, and for every manual-transfer order placed
   * before the columns existed — the API validated these fields and then
   * discarded them, so historic orders genuinely have no receipt on file and
   * the panel has to say so rather than render an empty box.
   *
   * On the detail schema only. The queue is a table of fifty rows and a
   * transaction ID is not something to spray across a list view.
   */
  senderNumber: z.string().nullable(),
  transactionId: z.string().nullable(),

  payments: z.array(adminPaymentSchema),

  /**
   * Which statuses this order may move to next, straight from the state
   * machine.
   *
   * Sent rather than reimplemented in the panel, because a client-side copy of
   * the transition table is a copy that drifts — and the failure when it does
   * is a button that looks enabled and returns 422. The machine is the single
   * definition of the lifecycle and this is it, over the wire.
   *
   * Empty for a terminal order, which is how the panel knows to draw no
   * actions at all rather than a row of disabled buttons.
   */
  allowedTransitions: z.array(z.enum(orderStatuses)),

  /**
   * Whether cancelling or refunding from here returns copies to the shelf.
   *
   * The panel needs it to warn before the click — "this will return 3 copies
   * to stock" — because that is the part of a cancellation an operator cannot
   * see and cannot undo.
   */
  releasesStockOnCancel: z.boolean(),

  /** The same two indicators the queue row carries, so the panel renders one shape. */
  receipt: receiptUniquenessSchema,
  verification: adminOrderVerificationStateSchema,

  /**
   * Every gateway check ever run against this order, newest first.
   *
   * The whole list rather than the latest, because the sequence is the story:
   * a receipt that was NOT_FOUND at 09:12 and MATCHED at 11:40 is an SMS that
   * arrived late, which is normal, and one that was MATCHED and later
   * UNAVAILABLE says something about the gateway rather than the customer.
   */
  verifications: z.array(paymentVerificationRecordSchema),
});

export type AdminOrderDetail = z.infer<typeof adminOrderDetailSchema>;

/**
 * The typed reason that lets a member of staff confirm an order whose receipt
 * is already on another live order.
 *
 * Optional, and absent means "do not override" — a duplicate is refused by
 * default and that stays the default. It exists because the previous escape
 * hatch was to *cancel the other order*, which is destructive, loses that
 * order's history, and is a terrible thing to ask of someone who simply knows
 * the customer paid twice from one wallet and wants to say so.
 *
 * A free-text reason rather than a boolean flag, and a long-ish minimum,
 * because the reason is the entire audit record of a deliberately bypassed
 * safety check. "ok" is not a reason and the schema should not accept it.
 */
export const duplicateReceiptOverrideSchema = z
  .string()
  .trim()
  .min(15, "Explain why this duplicate receipt is legitimate.")
  .max(500)
  .optional();

/**
 * Moving an order along.
 *
 * The target status is named explicitly rather than inferred from a "next"
 * button, so the request is idempotent in the way that matters: two clicks
 * both ask for SHIPPED, and the second is refused by the machine's guarded
 * update instead of advancing the order twice.
 */
export const adminOrderTransitionRequestSchema = z.object({
  status: z.enum(orderStatuses),
  /**
   * Lands on the append-only status history, where the customer *can* see it
   * on their tracking page. Staff-only remarks belong in the internal note.
   */
  note: z.string().trim().max(280).optional(),

  duplicateReceiptOverride: duplicateReceiptOverrideSchema,
});

export type AdminOrderTransitionRequest = z.infer<typeof adminOrderTransitionRequestSchema>;

/**
 * Recording a bank or bKash transfer that arrived out of band.
 *
 * The amount is required and is checked against the order total rather than
 * being taken on trust — the same check a gateway webhook gets. A staff member
 * confirming from a bank statement is reporting a fact, and a fact that
 * disagrees with the order is exactly what needs catching: it is either a
 * partial payment or the wrong reference matched to the wrong order.
 */
export const adminConfirmPaymentRequestSchema = z.object({
  amountCents: z.number().int().positive(),
  /**
   * The bank's or bKash's own transaction id, so the payment row points back
   * at the statement line it was matched from. Optional because some
   * statements give nothing usable, in which case the order number stands in.
   */
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(280).optional(),

  duplicateReceiptOverride: duplicateReceiptOverrideSchema,
});

export type AdminConfirmPaymentRequest = z.infer<typeof adminConfirmPaymentRequestSchema>;

/**
 * Recording a refund that has been issued elsewhere.
 *
 * This moves no money. There is no gateway integration to call and the manual
 * methods have none to offer — someone at the shop sends the transfer or hands
 * over cash, and this records that they did. Naming it that way in the API is
 * deliberate: an endpoint called `refund` that a staff member believes
 * *performs* a refund is a customer who never gets their money.
 *
 * A reason is required, unlike every other note in this file. A refund is the
 * one action that moves money out of the shop, and an unexplained one is
 * indistinguishable from a mistake six months later.
 */
export const adminRecordRefundRequestSchema = z.object({
  amountCents: z.number().int().positive(),
  reason: z.string().trim().min(1, "Say why this was refunded.").max(280),
});

export type AdminRecordRefundRequest = z.infer<typeof adminRecordRefundRequestSchema>;

/**
 * The staff-only note. Replaces rather than appends — it is a scratchpad on
 * the order, not a log; the log is `audit_log`, which records every previous
 * value of this field anyway.
 */
export const adminInternalNoteRequestSchema = z.object({
  note: z.string().trim().max(2000).nullable(),
});

export type AdminInternalNoteRequest = z.infer<typeof adminInternalNoteRequestSchema>;

/**
 * The result of cross-checking a manual-transfer order's transaction ID
 * against the SMS-gateway record.
 *
 * `NO_RECEIPT` is a fifth outcome layered on top of `paymentVerificationRecordSchema`'s
 * four (see payment-verification.ts) — distinct from `NOT_FOUND`, because there
 * is nothing to look up: a cash-on-delivery order, or a manual-transfer order
 * placed before the transaction-id field existed, was never going to match
 * anything and saying so would misreport an absent receipt as an unmatched one.
 *
 * Informational only — this never changes `orders.status` on its own. Acceptance
 * stays the admin's explicit `transition`/`confirmPayment` call.
 */
export const adminOrderVerifyPaymentResultSchema = z.object({
  record: z.union([paymentVerificationRecordSchema, z.object({ outcome: z.literal("NO_RECEIPT") })]),
  summary: z.string(),
});

export type AdminOrderVerifyPaymentResult = z.infer<typeof adminOrderVerifyPaymentResultSchema>;
