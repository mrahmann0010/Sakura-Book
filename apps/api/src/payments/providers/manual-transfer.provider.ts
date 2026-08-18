import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { PaymentMethod } from "@sakura/contracts";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Env } from "../../config/env.schema";
import { WebhookSignatureError } from "../payment.errors";
import type {
  PaymentContext,
  PaymentIntent,
  PaymentProvider,
  WebhookEvent,
} from "../payment-provider.port";

/**
 * Manual bank / bKash transfer.
 *
 * The customer pays out of band and quotes the order number as the reference;
 * someone at the shop matches it against the bank statement and confirms.
 *
 * There is no gateway here either, so the webhook is not a gateway's — it is
 * the integration point for whatever internal tool does the matching, signed
 * with a shared secret. That is deliberate: giving the manual method the same
 * verified, idempotent confirmation path as a real gateway means the day
 * SslCommerz is added, confirmation is not a new mechanism, it is a third
 * adapter. `PAYMENTS_WEBHOOK_SECRET` gates it, and without that configured the
 * route refuses everything.
 */
@Injectable()
export class ManualTransferProvider implements PaymentProvider {
  readonly name = "manual-transfer";
  readonly method: PaymentMethod = "manual-transfer";

  constructor(private readonly config: ConfigService<Env, true>) {}

  initiate(context: PaymentContext): PaymentIntent {
    return {
      referenceId: context.orderNumber,
      action: "instructions",
      // A key, not a sentence: the shop's account details and the wording
      // around them are rendered by the client in one of three languages.
      instructionKey: "payment.manualTransfer.instructions",
    };
  }

  /**
   * HMAC-SHA256 over the exact bytes received.
   *
   * `timingSafeEqual` rather than `===`, because a byte-by-byte string compare
   * leaks how much of a forged signature was right, and a signature check is
   * precisely where that leak is worth something to an attacker. Lengths are
   * compared first — timingSafeEqual throws on a mismatch — and a wrong length
   * is already a failure, so nothing is lost by branching on it.
   */
  verifyWebhook(
    raw: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): WebhookEvent {
    const secret: string | undefined = this.config.get("PAYMENTS_WEBHOOK_SECRET", {
      infer: true,
    });

    if (!secret) throw new WebhookSignatureError();

    const provided = headers["x-signature"];
    const signature = Array.isArray(provided) ? provided[0] : provided;

    if (!signature) throw new WebhookSignatureError();

    const expected = createHmac("sha256", secret).update(raw).digest("hex");
    const provided_ = Buffer.from(signature, "utf8");
    const expected_ = Buffer.from(expected, "utf8");

    if (provided_.length !== expected_.length || !timingSafeEqual(provided_, expected_)) {
      throw new WebhookSignatureError();
    }

    const payload = JSON.parse(raw.toString("utf8")) as {
      reference?: unknown;
      status?: unknown;
      amountCents?: unknown;
    };

    if (typeof payload.reference !== "string" || typeof payload.amountCents !== "number") {
      throw new WebhookSignatureError();
    }

    return {
      referenceId: payload.reference,
      // Anything that is not an explicit success is a failure. Defaulting the
      // other way would make a typo in the payload confirm an order.
      status: payload.status === "SUCCEEDED" ? "SUCCEEDED" : "FAILED",
      amountCents: payload.amountCents,
      raw: payload,
    };
  }
}
