/* --------------------------------------------------------------------------
   The vocabulary of a payment cross-check, kept free of pre-orders, orders, or
   anything else that might want one.

   This module answers exactly one question — "did ৳X arrive under this
   transaction ID?" — and answers it about a MongoDB that another service
   owns. It deliberately knows nothing about what the caller does with the
   answer: accepting a pre-order, approving a purchase and unlocking a
   download are three different decisions made by three different owners, and
   a verifier that made any of them would have to be forked to make the next.
   -------------------------------------------------------------------------- */

/**
 * The outcome vocabulary and the stored-record shape live in @sakura/contracts,
 * not here, because the admin panel renders both and a second definition on
 * this side is a second definition to keep in step. What stays local is the
 * runtime union below, which carries a `Date` and is therefore not a wire type.
 *
 * The provider list doubles as the MongoDB collection names — the collection
 * *is* the provider — and is ordered by how much traffic each carries, since
 * the lookup walks them in order and stops at the first hit.
 */
export {
  paymentProviders,
  type PaymentProvider,
  type PaymentVerificationOutcome,
  type PaymentVerificationRecord,
} from "@sakura/contracts";

import {
  // Re-exported above; imported again here for the local type annotations.
  type PaymentProvider,
  type PaymentVerificationRecord,
} from "@sakura/contracts";

/** One payment as the SMS gateway recorded it, narrowed to the fields we trust. */
export type MatchedPayment = {
  provider: PaymentProvider;
  /** Normalised — uppercase, trimmed. Matches what we queried on. */
  transactionId: string;
  /**
   * Minor units, converted from the gateway's taka on the way in. Everything
   * downstream of this module speaks cents, because everything upstream of it
   * — prices, totals, the entire Postgres schema — already does.
   */
  paidCents: number;
  /** When the SMS said the money arrived, not when we read it. */
  receivedAt: Date | null;
};

/**
 * What a cross-check concluded.
 *
 * A four-way union rather than a boolean, because the three failures are not
 * interchangeable and the caller's correct response differs for each:
 * NOT_FOUND may become a match later when the SMS arrives, UNDERPAID never
 * will without the customer sending more, and UNAVAILABLE says nothing about
 * the payment at all — it says we could not look.
 *
 * That last distinction is the one worth protecting. Collapsing UNAVAILABLE
 * into "not verified" is how a Mongo outage turns into a morning of orders
 * that look like they were checked and rejected.
 */
export type PaymentVerification =
  | ({ outcome: "MATCHED" } & MatchedPayment)
  | ({ outcome: "UNDERPAID"; expectedCents: number } & MatchedPayment)
  | { outcome: "NOT_FOUND"; transactionId: string }
  | { outcome: "UNAVAILABLE"; transactionId: string; reason: string };

/** What the caller must know to ask the question. */
export type VerifyPaymentRequest = {
  transactionId: string;
  /**
   * What we are owed, in minor units. The gateway records what arrived; only
   * the caller knows what should have. Underpayment is a business answer, not
   * a lookup failure, which is why the comparison happens here rather than
   * being left to each caller to remember.
   */
  expectedCents: number;
  /**
   * Restrict the search to one wallet, when the caller happens to know it.
   * Omitted, every collection is tried — see MongoPaymentsClient.findByTrxId
   * for why that is safe rather than merely convenient.
   */
  provider?: PaymentProvider;
};

/**
 * Flatten a verification for storage: what we concluded, when, and enough of
 * the evidence to explain it later without a second round trip to Mongo.
 */
export function toVerificationRecord(
  verification: PaymentVerification,
  expectedCents: number,
): PaymentVerificationRecord {
  const base = {
    outcome: verification.outcome,
    checkedAt: new Date().toISOString(),
    transactionId: verification.transactionId,
    expectedCents,
  };

  switch (verification.outcome) {
    case "MATCHED":
    case "UNDERPAID":
      return {
        ...base,
        provider: verification.provider,
        paidCents: verification.paidCents,
        receivedAt: verification.receivedAt?.toISOString(),
      };
    case "UNAVAILABLE":
      return { ...base, reason: verification.reason };
    case "NOT_FOUND":
      return base;
  }
}
