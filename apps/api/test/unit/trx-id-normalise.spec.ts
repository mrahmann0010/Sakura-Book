import { describe, expect, it } from "vitest";
import { normaliseTrxId } from "@project-sakura/pay";

/**
 * How two receipts are compared — the "is this receipt already on another of
 * our orders?" check, the generated column it mirrors, and the gateway.
 *
 * `normaliseTrxId` comes from @project-sakura/pay, so this is also the guard
 * on package upgrades: if the package ever changes the rule, the agreement
 * test below fails, and `transaction_id_normalised` needs a matching
 * migration before upgrading.
 */
describe("normaliseTrxId", () => {
  it("uppercases and strips whitespace, so a hand-typed ID matches the stored one", () => {
    expect(normaliseTrxId(" ab12 cd34ef ")).toBe("AB12CD34EF");
  });

  it("treats null and undefined as empty rather than crashing", () => {
    expect(normaliseTrxId(null)).toBe("");
    expect(normaliseTrxId(undefined)).toBe("");
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
    expect(normaliseTrxId("AB12 CD34EF")).toBe("AB12CD34EF");
    expect(normaliseTrxId("AB12​CD34EF")).toBe("AB12CD34EF");
    expect(normaliseTrxId(" AB12CD34EF ")).toBe("AB12CD34EF");
  });

  it("treats punctuation as noise, so PAY-123 and PAY123 are one receipt", () => {
    expect(normaliseTrxId("PAY-123")).toBe("PAY123");
    expect(normaliseTrxId("pay_123")).toBe("PAY123");
    expect(normaliseTrxId("PAY.123")).toBe("PAY123");
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
      expect(normaliseTrxId(sample)).toBe(sqlEquivalent(sample));
    }
  });

  it("returns empty for a receipt with nothing alphanumeric in it", () => {
    // The column stores NULL for this case, and NULLs do not collide under the
    // partial unique index — which is right: "---" is not a receipt.
    expect(normaliseTrxId("---")).toBe("");
  });
});
