import { describe, expect, it, vi } from "vitest";
import { MongoPaymentsClient } from "../../src/payment-verification/mongo-payments.client";
import {
  PaymentVerificationService,
  normaliseTransactionId,
} from "../../src/payment-verification/payment-verification.service";
import { toVerificationRecord } from "../../src/payment-verification/payment-verification.types";
import type { MatchedPayment } from "../../src/payment-verification/payment-verification.types";

/**
 * The verifier's contract, exercised against a stubbed gateway.
 *
 * Mongo itself is not in these tests on purpose: the parts worth protecting
 * are the amount comparison, the normalisation, and — above all — the promise
 * that nothing here ever throws. Those are decisions this class makes, not
 * behaviour of the driver.
 */
function serviceWith(
  find: (trxId: string) => Promise<MatchedPayment | null>,
  configured = true,
): PaymentVerificationService {
  const client = {
    configured,
    findByTrxId: vi.fn((trxId: string) => find(trxId)),
  } as unknown as MongoPaymentsClient;

  return new PaymentVerificationService(client);
}

const payment = (paidCents: number): MatchedPayment => ({
  provider: "bkash",
  transactionId: "AB12CD34EF",
  paidCents,
  receivedAt: new Date("2026-08-21T10:00:00Z"),
});

describe("normaliseTransactionId", () => {
  it("uppercases and strips whitespace, so a hand-typed ID matches the stored one", () => {
    expect(normaliseTransactionId(" ab12 cd34ef ")).toBe("AB12CD34EF");
  });

  it("treats null and undefined as empty rather than crashing", () => {
    expect(normaliseTransactionId(null)).toBe("");
    expect(normaliseTransactionId(undefined)).toBe("");
  });
});

describe("PaymentVerificationService", () => {
  it("matches when the gateway holds a receipt for at least the amount owed", async () => {
    const service = serviceWith(async () => payment(125000));

    const result = await service.verify({ transactionId: "ab12cd34ef", expectedCents: 125000 });

    expect(result.outcome).toBe("MATCHED");
    expect(result).toMatchObject({ provider: "bkash", paidCents: 125000 });
  });

  it("normalises before looking up, so a lower-case entry still finds the receipt", async () => {
    const seen: string[] = [];
    const service = serviceWith(async (trxId) => {
      seen.push(trxId);
      return payment(125000);
    });

    await service.verify({ transactionId: " ab12 cd34ef ", expectedCents: 125000 });

    expect(seen).toEqual(["AB12CD34EF"]);
  });

  it("accepts an overpayment — the customer has paid for their book", async () => {
    const service = serviceWith(async () => payment(130000));

    expect((await service.verify({ transactionId: "X", expectedCents: 125000 })).outcome).toBe(
      "MATCHED",
    );
  });

  it("refuses a payment one poisha short, and says how short", async () => {
    const service = serviceWith(async () => payment(124999));

    const result = await service.verify({ transactionId: "X", expectedCents: 125000 });

    expect(result).toMatchObject({
      outcome: "UNDERPAID",
      paidCents: 124999,
      expectedCents: 125000,
    });
  });

  it("reports NOT_FOUND rather than a failure when the SMS has not arrived yet", async () => {
    const service = serviceWith(async () => null);

    expect((await service.verify({ transactionId: "X", expectedCents: 1 })).outcome).toBe(
      "NOT_FOUND",
    );
  });

  it("reports UNAVAILABLE — never throws — when the gateway is unreachable", async () => {
    const service = serviceWith(async () => {
      throw new Error("connection refused");
    });

    const result = await service.verify({ transactionId: "X", expectedCents: 1 });

    expect(result.outcome).toBe("UNAVAILABLE");
  });

  it("reports UNAVAILABLE, not NOT_FOUND, when no gateway is configured", async () => {
    const service = serviceWith(async () => payment(1), false);

    const result = await service.verify({ transactionId: "X", expectedCents: 1 });

    // The distinction is the whole point: an unconfigured environment has not
    // established that the payment is missing, only that it cannot look.
    expect(result.outcome).toBe("UNAVAILABLE");
  });

  it("treats a blank transaction ID as nothing to find", async () => {
    const service = serviceWith(async () => payment(1));

    expect((await service.verify({ transactionId: "   ", expectedCents: 1 })).outcome).toBe(
      "NOT_FOUND",
    );
  });
});

describe("toVerificationRecord", () => {
  it("keeps the evidence for a match", () => {
    const record = toVerificationRecord({ outcome: "MATCHED", ...payment(125000) }, 125000);

    expect(record).toMatchObject({
      outcome: "MATCHED",
      provider: "bkash",
      paidCents: 125000,
      expectedCents: 125000,
    });
  });

  it("keeps the reason for an unavailable gateway, and no amounts it never read", () => {
    const record = toVerificationRecord(
      { outcome: "UNAVAILABLE", transactionId: "X", reason: "unreachable" },
      125000,
    );

    expect(record.reason).toBe("unreachable");
    expect(record.paidCents).toBeUndefined();
    expect(record.provider).toBeUndefined();
  });
});
