import { BusinessRuleError } from "../../common/errors";

/**
 * The gateway settled the question against this grant: the payment is
 * already spent by another order or business — or it is short, a reason to
 * accept it was given, and the gateway still refused (one too old to know
 * `acceptShortfall`).
 *
 * Not overridable. An override exists for "we can't tell yet", and this is
 * an answer.
 */
export class PaymentClaimRefusedError extends BusinessRuleError {
  readonly code = "PAYMENT_CLAIM_REFUSED";
}

/**
 * The gateway could not confirm the payment — the SMS has not arrived, the
 * gateway is unreachable, or it refused for a reason a person can judge.
 *
 * Staff may confirm anyway by re-sending with a `gatewayClaimOverride`
 * reason; the panel offers that box when it sees this code.
 */
export class PaymentNotClaimedError extends BusinessRuleError {
  readonly code = "PAYMENT_NOT_CLAIMED";
}

/**
 * The payment is short of the order total.
 *
 * Refused by default, as it always was. Staff may accept it by re-sending
 * with a `shortfallOverride` reason; the panel offers that box when it sees
 * this code. The payment is then claimed at the gateway as accepted-short, and
 * the shortfall is recorded.
 */
export class PaymentUnderpaidError extends BusinessRuleError {
  readonly code = "PAYMENT_UNDERPAID";
}
