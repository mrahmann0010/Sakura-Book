import { z } from "zod";
import { paymentMethods } from "./checkout";
import { paginated, pageQuerySchema } from "./pagination";
import {
  paymentVerificationOutcomes,
  paymentVerificationRecordSchema,
} from "./payment-verification";
import { preOrderFulfillmentStatuses, preOrderPaymentStatuses, preOrderSchema } from "./pre-order";

/* --------------------------------------------------------------------------
   Pre-order operations, as staff see them.

   Same division as admin-order.ts: the storefront's `PreOrder` is what a
   customer may see, and everything added here is either staff-only (the
   internal note, the sender number and transaction ID) or a decision aid the
   panel needs to draw controls correctly (the two `allowed*` arrays).

   The one shape worth noticing is that the transitions come in two arrays, not
   one. That is the whole point of splitting the column: verifying a payment
   and dispatching a parcel are different jobs, done by different people,
   months apart — a single "what can I do next" list would put them in one
   dropdown and imply a sequence that does not exist.
   -------------------------------------------------------------------------- */

export const adminPreOrderSorts = ["recent", "oldest", "total-desc"] as const;
export type AdminPreOrderSort = (typeof adminPreOrderSorts)[number];

export const adminPreOrderQuerySchema = pageQuerySchema({ defaultPageSize: 25 }).extend({
  /**
   * Both tracks are filterable, and independently — "everything awaiting
   * verification" and "everything paid but not yet shipped" are the two
   * queries the desk actually runs, and they name different columns.
   *
   * `preprocess` for the same reason as the order queue's: a repeated query
   * parameter arrives as a string once and an array twice.
   */
  paymentStatus: z
    .preprocess(
      (value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]),
      z.array(z.enum(preOrderPaymentStatuses)),
    )
    .optional(),

  fulfillmentStatus: z
    .preprocess(
      (value) => (value === undefined ? undefined : Array.isArray(value) ? value : [value]),
      z.array(z.enum(preOrderFulfillmentStatuses)),
    )
    .optional(),

  paymentMethod: z.enum(paymentMethods).optional(),

  /** Free text over order number, customer name, email and phone. */
  q: z.string().trim().min(1).max(120).optional(),

  placedFrom: z.iso.date().optional(),
  placedTo: z.iso.date().optional(),

  sort: z.enum(adminPreOrderSorts).default("recent"),
});

export type AdminPreOrderQuery = z.infer<typeof adminPreOrderQuerySchema>;

/** One row in the queue. Not the full pre-order — see admin-order.ts. */
export const adminPreOrderSummarySchema = z.object({
  orderNumber: z.string(),
  paymentStatus: z.enum(preOrderPaymentStatuses),
  fulfillmentStatus: z.enum(preOrderFulfillmentStatuses),
  placedAt: z.string().datetime(),
  customerName: z.string(),
  customerEmail: z.string(),
  customerPhone: z.string(),
  region: z.string(),
  paymentMethod: z.enum(paymentMethods),
  bookTitle: z.string(),
  quantity: z.number().int().positive(),
  currency: z.string().length(3),
  totalCents: z.number().int().nonnegative(),
  /**
   * A flag, not the reference. The queue shows whether there is something to
   * verify; the digits themselves are on the detail page, because a fifty-row
   * table of transaction IDs is a screenshot waiting to happen.
   */
  hasPaymentReference: z.boolean(),
  hasInternalNote: z.boolean(),
  /**
   * What the last automatic cross-check concluded, or null if none has run.
   *
   * On the summary rather than only the detail because it is the column that
   * tells a member of staff which of the remaining PENDING rows is worth
   * opening: NOT_FOUND means the SMS has not arrived and there is nothing to
   * do yet, while UNDERPAID and UNAVAILABLE are both rows that need a person.
   */
  verificationOutcome: z.enum(paymentVerificationOutcomes).nullable(),
});

export type AdminPreOrderSummary = z.infer<typeof adminPreOrderSummarySchema>;

export const adminPreOrderListSchema = paginated(adminPreOrderSummarySchema);
export type AdminPreOrderList = z.infer<typeof adminPreOrderListSchema>;

/**
 * The full pre-order, for the detail page.
 *
 * Built from `preOrderSchema` so the snapshot and totals are literally the
 * customer's view, plus the three things staff need and customers must not
 * see: what the customer claims they sent from, and the internal note.
 */
export const adminPreOrderDetailSchema = preOrderSchema.extend({
  paymentMethod: z.enum(paymentMethods),
  /** What the customer typed on the checkout's verify step. Unverified by definition. */
  senderNumber: z.string().nullable(),
  transactionId: z.string().nullable(),

  internalNote: z.string().nullable(),

  /**
   * The full record of the last cross-check against the SMS payment gateway.
   *
   * Sent to the panel so the accept/reject decision can be made against the
   * evidence rather than against a green tick: a member of staff overriding a
   * MATCHED verdict, or accepting an UNDERPAID one because the customer sent
   * the rest separately, both need to see the numbers the machine compared.
   */
  paymentVerification: paymentVerificationRecordSchema.nullable(),

  /**
   * Read off the two state machines at request time, never stored — a
   * persisted copy would need a backfill and would be wrong until it ran.
   *
   * Empty means terminal on that track, which is how the panel knows to draw
   * no buttons rather than a row of disabled ones.
   */
  allowedPaymentTransitions: z.array(z.enum(preOrderPaymentStatuses)),
  allowedFulfillmentTransitions: z.array(z.enum(preOrderFulfillmentStatuses)),
});

export type AdminPreOrderDetail = z.infer<typeof adminPreOrderDetailSchema>;

/**
 * Accept or reject the payment.
 *
 * Its own request rather than a generic "set status", because this is the
 * decision the whole split exists to record, and it is the one a person is
 * accountable for: the note lands on the audit entry next to who clicked it.
 */
export const adminPreOrderPaymentDecisionSchema = z.object({
  status: z.enum(preOrderPaymentStatuses),
  note: z.string().trim().max(280).optional(),
});

export type AdminPreOrderPaymentDecision = z.infer<typeof adminPreOrderPaymentDecisionSchema>;

/** Move the parcel along. Refused unless payment is ACCEPTED — see the machine. */
export const adminPreOrderFulfillmentTransitionSchema = z.object({
  status: z.enum(preOrderFulfillmentStatuses),
  note: z.string().trim().max(280).optional(),
});

export type AdminPreOrderFulfillmentTransition = z.infer<
  typeof adminPreOrderFulfillmentTransitionSchema
>;

export const adminPreOrderInternalNoteSchema = z.object({
  note: z.string().trim().max(2000).nullable(),
});

export type AdminPreOrderInternalNote = z.infer<typeof adminPreOrderInternalNoteSchema>;

/**
 * The answer to "check this against the gateway again".
 *
 * A response type rather than a request one: the re-check takes no arguments
 * — the transaction ID is already on the row, and letting the caller supply a
 * different one would turn a verification endpoint into a way to search the
 * shop's payment history. What comes back is the verdict *and* the pre-order,
 * because a MATCHED verdict changes the row and the panel must not have to
 * infer that from the outcome string.
 */
export const adminPreOrderVerificationResultSchema = z.object({
  verification: paymentVerificationRecordSchema,
  /** Human-readable summary of the verdict, ready to show. */
  summary: z.string(),
  /** True when this check is what moved the payment to ACCEPTED. */
  accepted: z.boolean(),
  preOrder: adminPreOrderDetailSchema,
});

export type AdminPreOrderVerificationResult = z.infer<typeof adminPreOrderVerificationResultSchema>;
