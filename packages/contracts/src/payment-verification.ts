import { z } from "zod";

/* --------------------------------------------------------------------------
   The shared vocabulary of a payment cross-check.

   Its own contract file rather than a section of admin-pre-order.ts, because
   nothing here is about pre-orders. A payment SMS forwarded into the gateway's
   MongoDB is checked the same way whoever is asking, and the next thing that
   needs verifying — a plain order, a reprint, a digital download — should
   inherit these shapes rather than restate them.
   -------------------------------------------------------------------------- */

/** The wallets the gateway files payments under, one collection each. */
export const paymentProviders = ["bkash", "nagad", "rocket"] as const;
export type PaymentProvider = (typeof paymentProviders)[number];

/**
 * What a cross-check concluded.
 *
 * Four outcomes rather than a boolean, because the three non-matches are not
 * interchangeable and the person reading them needs different things:
 *
 * - NOT_FOUND — the gateway has no such receipt *yet*. SMS arrive late; this
 *   is the outcome that most often becomes MATCHED on a re-check.
 * - UNDERPAID — the receipt exists and is short. Only the customer can fix it.
 * - UNAVAILABLE — we could not look. Says nothing about the payment at all,
 *   and collapsing it into "not verified" is how a gateway outage turns into
 *   a morning of orders that look checked and refused.
 */
export const paymentVerificationOutcomes = [
  "MATCHED",
  "UNDERPAID",
  "NOT_FOUND",
  "UNAVAILABLE",
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
  /** Only on UNAVAILABLE — why the lookup could not happen. */
  reason: z.string().optional(),
});

export type PaymentVerificationRecord = z.infer<typeof paymentVerificationRecordSchema>;
