import { Injectable, Logger } from "@nestjs/common";
import { MongoPaymentsClient } from "./mongo-payments.client";
import type { PaymentVerification, VerifyPaymentRequest } from "./payment-verification.types";

/**
 * Cross-checks a claimed payment against the SMS gateway's record of it.
 *
 * The reusable half of the flow, and the boundary is drawn where it is on
 * purpose: this returns a verdict and writes nothing. Pre-orders, orders and
 * whatever comes next each own a different notion of what "accepted" costs —
 * a status column, an audit entry, stock, access to a download — and a
 * verifier that also approved things would have to grow a branch per caller.
 * Ask it a question, act on the answer yourself.
 *
 * ## Never throws
 *
 * Every failure path returns UNAVAILABLE instead. That is not laziness about
 * error handling; it is the safety property the whole feature rests on. This
 * runs inside the checkout request, and a Mongo outage must degrade to "a
 * human will check this one" — never to a customer's pre-order failing after
 * they have already sent the money.
 */
@Injectable()
export class PaymentVerificationService {
  private readonly logger = new Logger(PaymentVerificationService.name);

  constructor(private readonly payments: MongoPaymentsClient) {}

  /** Whether this environment can cross-check at all — see MONGO_URI. */
  get enabled(): boolean {
    return this.payments.configured;
  }

  async verify(request: VerifyPaymentRequest): Promise<PaymentVerification> {
    /**
     * Uppercased and stripped of spaces, because the ID reaches us by hand:
     * the customer reads it off a payment SMS and types it into a form, and
     * `8f3k2m9x01` and `8F3K2M9X01` are the same receipt. The gateway's own
     * parser already stores these uppercase, so normalising here makes the
     * equality match rather than merely making it likelier to.
     */
    const transactionId = normaliseTransactionId(request.transactionId);

    if (!transactionId) {
      return { outcome: "NOT_FOUND", transactionId: "" };
    }

    if (!this.enabled) {
      return {
        outcome: "UNAVAILABLE",
        transactionId,
        reason: "MONGO_URI is not configured, so payments cannot be cross-checked.",
      };
    }

    try {
      const payment = await this.payments.findByTrxId(transactionId, request.provider);

      if (!payment) return { outcome: "NOT_FOUND", transactionId };

      /**
       * `>=`, not `===`. Someone who rounds ৳1,250 up to ৳1,300 has paid for
       * their book and should not be left in a queue; someone who sends ৳50
       * against a ৳1,250 order has not. Overpayment is a refund conversation,
       * not a reason to withhold the order — and it is a conversation the
       * stored `paidCents` makes possible later.
       */
      if (payment.paidCents < request.expectedCents) {
        return { outcome: "UNDERPAID", expectedCents: request.expectedCents, ...payment };
      }

      return { outcome: "MATCHED", ...payment };
    } catch (error) {
      // Logged without the transaction ID's surroundings — the ID itself is
      // fine, it is the customer's phone number and SMS text that are not.
      this.logger.error(
        `Could not cross-check payment ${transactionId} against the gateway: ${String(error)}`,
      );

      return {
        outcome: "UNAVAILABLE",
        transactionId,
        reason: "The payment gateway database could not be reached.",
      };
    }
  }
}

export function normaliseTransactionId(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, "").toUpperCase();
}
