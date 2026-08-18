import { InvalidInputError, NotAuthenticatedError, ResourceNotFoundError } from "../common/errors";

/** A `:provider` segment naming something we do not have an adapter for. */
export class UnknownPaymentProviderError extends ResourceNotFoundError {
  constructor(provider: string) {
    super("Payment provider", provider);
  }
}

/**
 * A webhook whose signature did not verify.
 *
 * 401 rather than 400: the request was well-formed and we are refusing it
 * because we cannot establish who sent it. The message says nothing about
 * which part failed — a caller probing for that is not a gateway.
 */
export class WebhookSignatureError extends NotAuthenticatedError {
  constructor() {
    super("Webhook signature verification failed");
  }
}

/**
 * A confirmation whose amount does not match what the order is owed.
 *
 * Refused rather than recorded, and this is the check worth having: a gateway
 * reporting a smaller amount than the order total means either a partial
 * payment or a tampered payload, and confirming the order on either would ship
 * goods that were not paid for. Recorded in the log with both figures because
 * this needs a human.
 */
export class PaymentAmountMismatchError extends InvalidInputError {
  constructor(orderNumber: string, expectedCents: number, receivedCents: number) {
    super(`Payment for ${orderNumber} does not match the order total`, {
      orderNumber,
      expectedCents,
      receivedCents,
    });
  }
}
