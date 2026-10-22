import { z } from "zod";

/* --------------------------------------------------------------------------
   The shared vocabulary of a payment cross-check.

   Its own contract file rather than a section of admin-pre-order.ts, because
   nothing here is about pre-orders. A payment is claimed at the gateway the
   same way whoever is asking, and the next thing that needs paying for — a
   plain order, a reprint, a digital download — should inherit these shapes
   rather than restate them.
   -------------------------------------------------------------------------- */

/** The wallets the gateway reads payment SMS from — its `platform` values. */
export const paymentProviders = ["bkash", "nagad", "rocket"] as const;
export type PaymentProvider = (typeof paymentProviders)[number];

/**
 * What a payment check concluded.
 *
 * Every check is now a claim through the gateway (`POST /v1/claims`), and
 * these eight are its answers:
 *
 * - CLAIMED — the payment is ours, spent once, for this order.
 * - PENDING_ARRIVAL — the SMS has not reached the gateway *yet*. SMS arrive
 *   late; this is the outcome that most often becomes CLAIMED on a retry.
 * - UNDERPAID — the payment exists and is short. Only the customer can fix it.
 * - ALREADY_CLAIMED — another order or business has already spent it.
 * - RELEASED — a gateway admin released our earlier claim.
 * - REJECTED — the payment exists but the gateway won't let this shop spend
 *   it (too old, over the limit, wrong sender, ambiguous wallet).
 * - MISCONFIGURED — our request or credential is wrong. A bug, not a payment fact.
 * - UNAVAILABLE — we could not ask. Says nothing about the payment at all,
 *   and collapsing it into "not verified" is how a gateway outage turns into
 *   a morning of orders that look checked and refused.
 *
 * MATCHED and NOT_FOUND are from before claims, when the shop read the
 * gateway's database directly. Kept so older history still reads.
 */
export const paymentVerificationOutcomes = [
  // The original four, first and in their original order: this list is also
  // a Postgres enum, and new values are appended rather than inserted.
  "MATCHED",
  "UNDERPAID",
  "NOT_FOUND",
  "UNAVAILABLE",
  "CLAIMED",
  "PENDING_ARRIVAL",
  "ALREADY_CLAIMED",
  "RELEASED",
  "REJECTED",
  "MISCONFIGURED",
] as const;
export type PaymentVerificationOutcome = (typeof paymentVerificationOutcomes)[number];

/**
 * A stored verification — what we concluded, when, and enough of the evidence
 * to explain it later without going back to the gateway.
 *
 * Every field past `outcome` is optional because the shape genuinely differs
 * per outcome: there is no provider for a receipt that was never found, and no
 * amount for a gateway that could not be reached.
 */
export const paymentVerificationRecordSchema = z.object({
  outcome: z.enum(paymentVerificationOutcomes),
  checkedAt: z.string().datetime(),
  transactionId: z.string(),
  provider: z.enum(paymentProviders).optional(),
  /** Minor units, converted from the gateway's taka. See CURRENCY. */
  paidCents: z.number().int().nonnegative().optional(),
  expectedCents: z.number().int().nonnegative().optional(),
  receivedAt: z.string().datetime().optional(),
  /** On CLAIMED: how much more than the order total arrived. Owed back or credited. */
  overpaidCents: z.number().int().nonnegative().optional(),
  /** On CLAIMED: how much less than the total arrived, when staff accepted a short payment. */
  underpaidCents: z.number().int().nonnegative().optional(),
  /** When the payment was claimed — ours on CLAIMED, someone else's on ALREADY_CLAIMED. */
  claimedAt: z.string().datetime().optional(),
  /** The idempotency key the claim was sent with, `<orderNumber>:<attempt>`. */
  claimKey: z.string().optional(),
  /** Why the check could not succeed — on UNAVAILABLE, REJECTED and MISCONFIGURED. */
  reason: z.string().optional(),
});

export type PaymentVerificationRecord = z.infer<typeof paymentVerificationRecordSchema>;
