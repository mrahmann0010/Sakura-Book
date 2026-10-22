import type { PaymentProvider, PaymentVerificationRecord } from "@sakura/contracts";

/* --------------------------------------------------------------------------
   The app's own words for what the payment gateway said.

   The gateway answers a claim with one of a dozen `reason` codes. None of
   them leave this module: the HTTP client translates each into one of the
   outcomes below, so a change to the gateway's contract touches one file and
   order code never switches on a gateway string.

   Everything here is in cents. The gateway speaks taka; the conversion
   happens at the edge, in the HTTP client.
   -------------------------------------------------------------------------- */

export type ClaimRequest = {
  /** As the customer typed it. The gateway ignores case, spaces and dashes. */
  trxId: string;
  /** The order total, in cents. Sent to the gateway as taka. */
  expectedCents: number;
  /**
   * One key per attempt to pay for one order — `<orderNumber>:<attempt>`.
   * Reused on every retry, so a retry gets back our own earlier success
   * instead of colliding with it.
   */
  idempotencyKey: string;
  /** Our order number, shown in the gateway's ledger. */
  orderRef?: string;
  /**
   * The wallet the customer said they paid from. Not sent on the first try —
   * only used to settle an `ambiguous_trx` answer. See PaymentClaimService.
   */
  provider?: PaymentProvider;
  /**
   * The number the customer says they paid from, as `01XXXXXXXXX`. The
   * gateway requires it for clients with "require sender match" switched on,
   * and refuses a claim whose payer does not match.
   */
  senderPhone?: string;
};

/** Why the gateway refused a payment that does exist. */
export type ClaimRejection =
  /** Older than this client's claim window. */
  | "TOO_OLD"
  /** Above this client's per-claim ceiling. */
  | "OVER_LIMIT"
  /** The payer's phone did not match. */
  | "SENDER_MISMATCH"
  /** The ID exists on more than one wallet, and we did not say which. */
  | "AMBIGUOUS";

export type ClaimOutcome =
  /** We own this payment. `replay` is true when it was our own earlier claim. */
  | {
      outcome: "CLAIMED";
      trxId: string;
      provider: PaymentProvider;
      paidCents: number;
      overpaidCents: number;
      claimedAt: Date;
      replay: boolean;
    }
  /** The SMS has not reached the gateway yet. Retry with the same key. */
  | { outcome: "PENDING_ARRIVAL" }
  /** The payment exists and is short. It stays unclaimed so the customer can top up. */
  | { outcome: "UNDERPAID"; expectedCents: number; paidCents: number | null }
  /** Another order or business has already spent this payment. */
  | { outcome: "ALREADY_CLAIMED"; claimedAt: Date | null }
  /** A gateway admin released our earlier claim. Retrying needs a new key. */
  | { outcome: "RELEASED" }
  /** The payment exists but this client may not spend it. */
  | { outcome: "REJECTED"; rejection: ClaimRejection; reason: string }
  /** Our request or our credentials are wrong. A bug or a config problem, never retried. */
  | { outcome: "MISCONFIGURED"; reason: string }
  /** We could not ask: network, timeout, 5xx, rate limit, or not configured. */
  | { outcome: "UNAVAILABLE"; reason: string; retryAfterSeconds?: number };

export type ClaimOutcomeName = ClaimOutcome["outcome"];

/**
 * Flatten a claim for the verification log: what we concluded, when, and
 * enough of the evidence to explain it later without asking the gateway
 * again — which is not possible anyway, since it has no read endpoint.
 */
export function toClaimRecord(
  outcome: ClaimOutcome,
  context: { transactionId: string; expectedCents: number; claimKey: string },
): PaymentVerificationRecord {
  const base = {
    outcome: outcome.outcome,
    checkedAt: new Date().toISOString(),
    transactionId: context.transactionId,
    expectedCents: context.expectedCents,
    claimKey: context.claimKey,
  };

  switch (outcome.outcome) {
    case "CLAIMED":
      return {
        ...base,
        provider: outcome.provider,
        paidCents: outcome.paidCents,
        overpaidCents: outcome.overpaidCents,
        claimedAt: outcome.claimedAt.toISOString(),
      };
    case "UNDERPAID":
      return { ...base, paidCents: outcome.paidCents ?? undefined };
    case "ALREADY_CLAIMED":
      return { ...base, claimedAt: outcome.claimedAt?.toISOString() };
    case "REJECTED":
    case "MISCONFIGURED":
    case "UNAVAILABLE":
      return { ...base, reason: outcome.reason };
    case "PENDING_ARRIVAL":
    case "RELEASED":
      return base;
  }
}
