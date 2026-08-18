import type { PaymentMethod } from "@sakura/contracts";

/**
 * What checkout and the webhook route need from a way of taking money.
 *
 * A port with adapters because `payments.provider` is a free-text column
 * commented "abstracted, swappable", and this is the code shape that comment
 * implies. Cash on delivery and manual bank/bKash transfer ship now;
 * SslCommerz or Stripe should arrive as a third file here and change nothing
 * about orders, checkout, or the status machine.
 *
 * Note what the port does *not* expose: anything that moves an order's status.
 * Providers report facts about payments — "this reference was paid" — and
 * PaymentsService decides what that means for the order. A provider that could
 * transition an order directly would be a second write path into a column the
 * whole design says has exactly one.
 */
export type PaymentIntent = {
  /**
   * The provider's own handle for this attempt, stored as
   * `payments.provider_reference_id`. For gateways it is their session or
   * transaction id; for the manual methods there is no gateway to ask, so the
   * order number is used — it is already unique, and it is what a customer
   * writes on a bank transfer.
   */
  referenceId: string;

  /**
   * What the customer has to do next, if anything.
   *
   * `none` — nothing to do; the shop collects on delivery.
   * `instructions` — pay out of band and quote the reference.
   * `redirect` — send the browser to `redirectUrl` (no provider does this yet).
   */
  action: "none" | "instructions" | "redirect";

  redirectUrl?: string;

  /**
   * Keys, not sentences. The frontend renders these in three languages, so a
   * provider returning "Send ৳450 to bKash 01…" would be a server deciding
   * copy in one of them. The reference and the amount travel as data; the
   * wording lives in the locale bundles.
   */
  instructionKey?: string;
};

/**
 * A payment event, as understood after verifying whoever sent it.
 *
 * `SUCCEEDED` is the only one that confirms an order. `FAILED` records the
 * attempt without touching the order, because a failed attempt is not a
 * cancellation — the customer may simply try again.
 */
export type WebhookEvent = {
  referenceId: string;
  status: "SUCCEEDED" | "FAILED";
  amountCents: number;
  /** The gateway's payload, stored verbatim for debugging without schema churn. */
  raw: unknown;
};

export type PaymentContext = {
  orderNumber: string;
  totalCents: number;
  currency: string;
};

export interface PaymentProvider {
  /** Matches `payments.provider` and the `:provider` path segment. */
  readonly name: string;

  /** The checkout method this provider serves. */
  readonly method: PaymentMethod;

  initiate(context: PaymentContext): PaymentIntent;

  /**
   * Verify authenticity and parse. Throws if the signature does not check out.
   *
   * Takes the raw Buffer rather than the parsed body deliberately: a signature
   * covers the exact bytes that were sent, and `JSON.parse` followed by
   * re-serialisation does not reproduce them. This is why the webhook route
   * needs raw-body access configured.
   */
  verifyWebhook(raw: Buffer, headers: Record<string, string | string[] | undefined>): WebhookEvent;
}
