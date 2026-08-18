import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import type { ConfigService } from "@nestjs/config";
import type { Env } from "../../src/config/env.schema";
import { CashOnDeliveryProvider } from "../../src/payments/providers/cash-on-delivery.provider";
import { ManualTransferProvider } from "../../src/payments/providers/manual-transfer.provider";
import { WebhookSignatureError } from "../../src/payments/payment.errors";

const SECRET = "a-test-secret-at-least-16";

/** A ConfigService stub — the provider reads exactly one key. */
function configWith(secret?: string): ConfigService<Env, true> {
  return { get: () => secret } as unknown as ConfigService<Env, true>;
}

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(Buffer.from(body, "utf8")).digest("hex");
}

const context = { orderNumber: "MG-40718", totalCents: 145000, currency: "BDT" };

describe("CashOnDeliveryProvider", () => {
  const provider = new CashOnDeliveryProvider();

  it("needs nothing from the customer at checkout", () => {
    expect(provider.initiate(context)).toEqual({ referenceId: "MG-40718", action: "none" });
  });

  it("refuses webhooks outright", () => {
    // Nothing posts webhooks for cash. Accepting one quietly would mean an
    // unauthenticated route could confirm a COD order as paid.
    expect(() => provider.verifyWebhook()).toThrow();
  });
});

describe("ManualTransferProvider.verifyWebhook", () => {
  const provider = new ManualTransferProvider(configWith(SECRET));
  const body = JSON.stringify({ reference: "MG-40718", status: "SUCCEEDED", amountCents: 145000 });

  it("accepts a correctly signed payload", () => {
    const event = provider.verifyWebhook(Buffer.from(body), { "x-signature": sign(body) });

    expect(event).toMatchObject({
      referenceId: "MG-40718",
      status: "SUCCEEDED",
      amountCents: 145000,
    });
  });

  it("rejects a tampered payload under a valid-looking signature", () => {
    const tampered = JSON.stringify({
      reference: "MG-40718",
      status: "SUCCEEDED",
      amountCents: 1,
    });

    expect(() =>
      provider.verifyWebhook(Buffer.from(tampered), { "x-signature": sign(body) }),
    ).toThrow(WebhookSignatureError);
  });

  it("rejects a missing signature", () => {
    expect(() => provider.verifyWebhook(Buffer.from(body), {})).toThrow(WebhookSignatureError);
  });

  it("rejects a signature of the wrong length without throwing from timingSafeEqual", () => {
    // timingSafeEqual throws a TypeError on unequal lengths, which would escape
    // as a 500 instead of a 401. The length check exists for that.
    expect(() => provider.verifyWebhook(Buffer.from(body), { "x-signature": "abc" })).toThrow(
      WebhookSignatureError,
    );
  });

  it("refuses everything when no secret is configured", () => {
    // A missing secret must never mean "skip the check" — that would make the
    // confirm-an-order-as-paid route open to anyone.
    const unconfigured = new ManualTransferProvider(configWith(undefined));

    expect(() => unconfigured.verifyWebhook(Buffer.from(body), { "x-signature": sign(body) })).toThrow(
      WebhookSignatureError,
    );
  });

  it("treats anything that is not an explicit success as a failure", () => {
    const odd = JSON.stringify({ reference: "MG-40718", status: "succeeded", amountCents: 145000 });

    expect(provider.verifyWebhook(Buffer.from(odd), { "x-signature": sign(odd) }).status).toBe(
      "FAILED",
    );
  });
});
