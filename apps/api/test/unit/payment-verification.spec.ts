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

  /**
   * The bug this function was rewritten for.
   *
   * A receipt copied out of a bKash SMS, or forwarded through a messaging app,
   * routinely carries a non-breaking space or a zero-width character. The old
   * implementation used `\s`, which JavaScript matches against U+00A0 but the
   * POSIX regex in the SQL half did not — so the value went into the column
   * one way and was searched for another way, and a receipt never matched
   * itself. Two orders could hold one payment and nothing objected.
   */
  it("strips the invisible characters a pasted receipt carries", () => {
    expect(normaliseTransactionId("AB12 CD34EF")).toBe("AB12CD34EF");
    expect(normaliseTransactionId("AB12​CD34EF")).toBe("AB12CD34EF");
    expect(normaliseTransactionId(" AB12CD34EF ")).toBe("AB12CD34EF");
  });

  it("treats punctuation as noise, so PAY-123 and PAY123 are one receipt", () => {
    expect(normaliseTransactionId("PAY-123")).toBe("PAY123");
    expect(normaliseTransactionId("pay_123")).toBe("PAY123");
    expect(normaliseTransactionId("PAY.123")).toBe("PAY123");
  });

  /**
   * Pins the exact expression the `transaction_id_normalised` generated column
   * is defined with, in `db/schema/orders/order.ts`. The two halves must agree
   * character for character: Postgres normalises what is stored, this
   * normalises what is searched for, and a difference between them is
   * undetectable at runtime and silently stops the duplicate check working.
   *
   * If this test fails because the column changed, change this — do not change
   * the assertion to match the code without changing the column too.
   */
  it("matches the SQL the generated column uses", () => {
    const sqlEquivalent = (value: string) => value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

    for (const sample of ["AB12 CD34", "pay-123", "  x  ", "!!!", "aA1"]) {
      expect(normaliseTransactionId(sample)).toBe(sqlEquivalent(sample));
    }
  });

  it("returns empty for a receipt with nothing alphanumeric in it", () => {
    // The column stores NULL for this case, and NULLs do not collide under the
    // partial unique index — which is right: "---" is not a receipt.
    expect(normaliseTransactionId("---")).toBe("");
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
