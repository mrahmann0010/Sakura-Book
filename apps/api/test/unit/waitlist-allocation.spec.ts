import { describe, expect, it, vi } from "vitest";
import { WaitlistAllocationService } from "../../src/waitlist/waitlist-allocation.service";

/**
 * What a stock release will let staff give away.
 *
 * The arithmetic is the whole feature. `copies` is a decision a person typed;
 * every other number is derived on read, and the one staff act on —
 * `spendable` — is the *smaller* of two independent limits. Getting that
 * wrong in either direction is expensive and silent: too high and the shop
 * texts links for copies it does not have, too low and a restock morning
 * stalls with stock on the shelf and people waiting for it.
 *
 * These stub the query chain rather than the database. The SQL is exercised by
 * the real thing; what needs pinning here is the min/max/floor logic sitting
 * on top of it, which is pure and easy to get subtly wrong.
 */
function service(row: Record<string, unknown> | undefined) {
  const dbService = {
    db: {
      select: vi.fn().mockReturnValue({
        from: () => ({
          innerJoin: () => ({ where: () => Promise.resolve(row ? [row] : []) }),
          where: () => Promise.resolve(row ? [row] : []),
        }),
      }),
    },
  };

  return new WaitlistAllocationService(dbService as never);
}

function allocationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "alloc-1",
    copies: 50,
    stockSnapshot: 60,
    note: null,
    openedAt: new Date("2026-09-01T00:00:00Z"),
    openedByEmail: "staff@shop.com",
    committed: 0,
    stockQuantity: 60,
    physicalSpare: 60,
    ...overrides,
  };
}

describe("WaitlistAllocationService.describe — what the queue may still be promised", () => {
  it("returns null when no release is open, which is a refusal and not a zero", async () => {
    // The distinction the invite path depends on. "No release" must never be
    // read as "zero copies" *or* as "fall back to the print run" — the second
    // is exactly the behaviour releases exist to end.
    expect(await service(undefined).describe("book-1")).toBeNull();
  });

  it("holds back the walk-in reserve by arithmetic, not by a second column", async () => {
    // 60 in stock, 50 allocated, nothing spent yet. The shop's ten counter
    // copies are not marked anywhere — they are what is left once the queue
    // can only ever hold 50.
    const budget = await service(allocationRow()).describe("book-1");

    expect(budget!.remaining).toBe(50);
    expect(budget!.spendable).toBe(50);
  });

  it("counts a spent copy as spent, so a sale does not free the copy it took", async () => {
    const budget = await service(
      allocationRow({ committed: 31, physicalSpare: 29 }),
    ).describe("book-1");

    expect(budget!.remaining).toBe(19);
    expect(budget!.spendable).toBe(19);
  });

  it("lets physical stock win when the release allocated more than exists", async () => {
    // 80 promised to the queue on a 60-copy book. Allocation narrows; it never
    // widens, and no number typed into the panel conjures books.
    const budget = await service(
      allocationRow({ copies: 80, stockQuantity: 60, physicalSpare: 60 }),
    ).describe("book-1");

    expect(budget!.remaining).toBe(80);
    expect(budget!.spendable).toBe(60);
  });

  it("lets the release win when it is the tighter of the two", async () => {
    // Plenty of stock, but this restock only gave the waitlist five. The point
    // of the whole table: the queue does not get to eat the shelf.
    const budget = await service(
      allocationRow({ copies: 5, committed: 0, stockQuantity: 200, physicalSpare: 200 }),
    ).describe("book-1");

    expect(budget!.spendable).toBe(5);
  });

  it("reports an over-issued book as nothing to give, and flags it for a human", async () => {
    // An admin lowered stock under live invites: more copies are promised than
    // the shop owns. `spendable` floored at zero rather than negative, because
    // a negative allowance is the kind of number a later `>=` accepts by
    // accident — and the flag, because only a person can resolve it.
    const budget = await service(
      allocationRow({ committed: 10, stockQuantity: 5, physicalSpare: -8 }),
    ).describe("book-1");

    expect(budget!.spendable).toBe(0);
    expect(budget!.overIssued).toBe(true);
  });

  it("floors its own budget at zero when a release is over-committed", async () => {
    // `copies` can be lowered under invites already charged to the release,
    // the same way stock can. Same reasoning, same floor.
    const budget = await service(
      allocationRow({ copies: 10, committed: 14, physicalSpare: 40 }),
    ).describe("book-1");

    expect(budget!.remaining).toBe(0);
    expect(budget!.spendable).toBe(0);
  });

  it("keeps the snapshot separate from live stock, so '50 of 60' stays readable", async () => {
    // The snapshot is a record of the decision; the live count is what limits
    // it. Conflating them would either rewrite history or price against a
    // number that is months old.
    const budget = await service(
      allocationRow({ stockSnapshot: 60, stockQuantity: 12, physicalSpare: 12 }),
    ).describe("book-1");

    expect(budget!.stockSnapshot).toBe(60);
    expect(budget!.stockQuantity).toBe(12);
    expect(budget!.spendable).toBe(12);
  });
});

describe("WaitlistAllocationService.spendableByBook — the invite path's budget", () => {
  function batchService(rows: Record<string, unknown>[]) {
    const dbService = {
      db: {
        select: vi.fn().mockReturnValue({
          from: () => ({ innerJoin: () => ({ where: () => Promise.resolve(rows) }) }),
        }),
      },
    };

    return new WaitlistAllocationService(dbService as never);
  }

  it("omits books with no open release rather than mapping them to zero", async () => {
    // The caller must be able to tell "this release is spent" from "nobody has
    // decided how much of this restock the queue gets" — the first is a wait,
    // the second is a setup step, and they need different messages.
    const budgets = await batchService([]).spendableByBook(["book-a"]);

    expect(budgets.has("book-a")).toBe(false);
  });

  it("carries the allocation id so the invite it funds can be charged back to it", async () => {
    // Without this the hold exists and no release accounts for it, so the
    // budget it was checked against reports the copies as free again.
    const budgets = await batchService([
      { bookId: "book-a", allocationId: "alloc-1", copies: 50, committed: 10, physicalSpare: 60 },
    ]).spendableByBook(["book-a"]);

    expect(budgets.get("book-a")).toEqual({ allocationId: "alloc-1", spendable: 40 });
  });

  it("takes the tighter of the release and the shelf, per book", async () => {
    const budgets = await batchService([
      { bookId: "book-a", allocationId: "a", copies: 50, committed: 0, physicalSpare: 3 },
      { bookId: "book-b", allocationId: "b", copies: 2, committed: 0, physicalSpare: 90 },
    ]).spendableByBook(["book-a", "book-b"]);

    expect(budgets.get("book-a")!.spendable).toBe(3);
    expect(budgets.get("book-b")!.spendable).toBe(2);
  });

  it("never reports a negative budget", async () => {
    const budgets = await batchService([
      { bookId: "book-a", allocationId: "a", copies: 5, committed: 9, physicalSpare: -4 },
    ]).spendableByBook(["book-a"]);

    expect(budgets.get("book-a")!.spendable).toBe(0);
  });

  it("asks nothing of the database for an empty book list", async () => {
    // The invite path calls this with whatever books a selection touched, and
    // an all-OPEN batch touches none. A query with an empty `in ()` would be a
    // syntax error rather than an empty answer.
    const dbService = { db: { select: vi.fn() } };
    const empty = new WaitlistAllocationService(dbService as never);

    expect(await empty.spendableByBook([])).toEqual(new Map());
    expect(dbService.db.select).not.toHaveBeenCalled();
  });
});
