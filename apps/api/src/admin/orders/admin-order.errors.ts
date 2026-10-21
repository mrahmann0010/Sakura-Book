import { BusinessRuleError } from "../../common/errors";

/**
 * The gateway settled the question against this grant: the payment is
 * already spent by another order or business, or it is short.
 *
 * Not overridable. An override exists for "we can't tell yet", and both of
 * these are answers.
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
