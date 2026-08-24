import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { receiptUniquenessOf } from "../../src/admin/orders/admin-order.mapper";
import { RELEASED_STATUSES } from "../../src/orders/transaction-id-claim";

/**
 * The badge the admin queue is read for.
 *
 * These are the four answers a member of staff gets before they touch
 * anything, so the distinctions matter more than they look: "no receipt" and
 * "duplicate" are both "not unique" to a boolean and completely different
 * problems to a person.
 */
describe("receiptUniquenessOf", () => {
  const manualTransfer = (transactionIdNormalised: string | null) => ({
    paymentMethod: "manual-transfer",
    transactionIdNormalised,
  });

  it("reports a receipt no other live order holds as unique", () => {
    expect(receiptUniquenessOf(manualTransfer("PAY123"), new Set())).toEqual({
      state: "UNIQUE",
      claimedByOrderNumber: null,
    });
  });

  it("reports a receipt another live order holds as a duplicate, and names it", () => {
    expect(receiptUniquenessOf(manualTransfer("PAY123"), new Set(["PAY123"]), "NB-40718")).toEqual({
      state: "DUPLICATE",
      claimedByOrderNumber: "NB-40718",
    });
  });

  /**
   * The queue does not know the conflicting order's number — naming it costs a
   * lookup per row — so DUPLICATE without a name is a legitimate shape, and
   * the badge must still render. Only the detail view fills the name in.
   */
  it("still reports a duplicate when the other order has not been named", () => {
    expect(receiptUniquenessOf(manualTransfer("PAY123"), new Set(["PAY123"]))).toEqual({
      state: "DUPLICATE",
      claimedByOrderNumber: null,
    });
  });

  /**
   * Every manual-transfer order placed before the receipt columns existed
   * lands here. It is a real state on a production database, not an edge case
   * — the panel has to say "no receipt on file" rather than render an empty
   * box or, worse, call it unique.
   */
  it("reports a manual transfer with no receipt as missing, not unique", () => {
    expect(receiptUniquenessOf(manualTransfer(null), new Set())).toEqual({
      state: "MISSING",
      claimedByOrderNumber: null,
    });
  });

  it("answers not-applicable for cash on delivery before looking at the receipt", () => {
    expect(
      receiptUniquenessOf(
        { paymentMethod: "cash-on-delivery", transactionIdNormalised: null },
        new Set(),
      ),
    ).toEqual({ state: "NOT_APPLICABLE", claimedByOrderNumber: null });
  });
});

/**
 * The rule about which orders still hold a claim on a receipt is written
 * twice: once in `RELEASED_STATUSES`, which the application query filters on,
 * and once in the WHERE clause of `orders_transaction_id_live_unique_idx`,
 * which the database enforces.
 *
 * They must describe the same set. If the constraint were stricter than the
 * query, checkout would refuse orders the panel says are fine; if it were
 * looser, the constraint would stop catching the race it exists for. Neither
 * failure shows up until it happens to a customer.
 */
describe("the released-statuses rule", () => {
  /**
   * Read out of the migration rather than out of the Drizzle table object,
   * because the migration is what the production database actually ran. A
   * schema file that says one thing and an applied index that says another is
   * precisely the drift worth catching, and only the SQL can report it.
   */
  const migration = readFileSync(
    join(__dirname, "..", "..", "drizzle", "0019_receipt_uniqueness.sql"),
    "utf8",
  );

  it("is the same in the query and in the unique index", () => {
    const [, predicate] =
      /CREATE UNIQUE INDEX "orders_transaction_id_live_unique_idx".*?WHERE (.+)$/m.exec(migration) ??
      [];

    expect(predicate, "the unique index is missing from migration 0019").toBeDefined();

    const excludedByTheIndex = [...(predicate ?? "").matchAll(/<> '([A-Z_]+)'/g)]
      .map(([, status]) => status)
      .sort();

    expect(excludedByTheIndex).toEqual([...RELEASED_STATUSES].sort());
  });

  it("does not release a PENDING order's claim", () => {
    // PENDING is exactly the state a receipt sits in while it waits to be
    // checked, so releasing it would make the whole guard a no-op for the
    // window it matters most.
    expect(RELEASED_STATUSES).not.toContain("PENDING");
  });
});
