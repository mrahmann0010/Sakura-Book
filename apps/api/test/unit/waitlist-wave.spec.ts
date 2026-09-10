import { describe, expect, it, vi } from "vitest";
import { AdminWaitlistWaveService } from "../../src/admin/waitlist/admin-waitlist-wave.service";
import { adminWaitlistOrder } from "../../src/admin/waitlist/admin-waitlist.query";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * Who the next wave goes to, and how many of them.
 *
 * Two properties, and both are promises the shop made rather than
 * optimisations. The queue is served in the order people joined it, and a wave
 * is exactly as large as the release can fund — no overbooking, because the
 * person who misses out here is a real customer the shop will hear from.
 */

type Candidate = {
  id: string;
  quantity: number;
  customerName: string;
  attempts: number;
};

function service(candidates: Candidate[], spendable: number | null) {
  const dbService = {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({ orderBy: () => ({ limit: () => Promise.resolve(candidates) }) }),
        }),
      }),
    },
  };

  const allocation = {
    describe: vi
      .fn()
      .mockResolvedValue(spendable === null ? null : { id: "alloc-1", spendable }),
  };

  return new AdminWaitlistWaveService(
    dbService as never,
    allocation as never,
    { ttlHours: async () => 48 } as never,
    { invite: vi.fn() } as never,
  );
}

function candidate(id: string, overrides: Partial<Candidate> = {}): Candidate {
  return { id, quantity: 1, customerName: `Person ${id}`, attempts: 0, ...overrides };
}

describe("AdminWaitlistWaveService.plan — a wave is as big as the release can fund", () => {
  it("refuses outright when no release is open", async () => {
    // Not an empty wave. "Nobody has decided how much of this restock the
    // queue gets" is a setup step, and reporting it as "no copies left" would
    // send staff looking for lapsed invites that do not exist.
    await expect(service([], null).plan("book-1")).rejects.toThrow(/No open stock release/);
  });

  it("stops at the budget rather than inviting everyone waiting", async () => {
    // Three hundred waiting, fifty copies. The whole point: the other 250 are
    // not texted a link they cannot use.
    const plan = await service(
      Array.from({ length: 300 }, (_, index) => candidate(`e${index}`)),
      50,
    ).plan("book-1");

    expect(plan.ids).toHaveLength(50);
    expect(plan.quantity).toBe(50);
    expect(plan.waiting).toBe(300);
  });

  it("does not overbook, even by one", async () => {
    // The decision recorded in the wave table's comment. Inviting 51 for 50
    // means one customer fills in a checkout form to be told no.
    const plan = await service(
      Array.from({ length: 10 }, (_, index) => candidate(`e${index}`)),
      3,
    ).plan("book-1");

    expect(plan.ids).toHaveLength(3);
  });

  it("counts copies, not people", async () => {
    // Two people asking for two each is four copies off a five-copy budget;
    // the third person's two do not fit even though they are only the third.
    const plan = await service(
      ["a", "b", "c"].map((id) => candidate(id, { quantity: 2 })),
      5,
    ).plan("book-1");

    expect(plan.ids).toEqual(["a", "b"]);
    expect(plan.quantity).toBe(4);
  });

  it("skips an entry too large to fit rather than stopping on it", async () => {
    // One person wanting five copies must not stall the four behind them who
    // want one each — the queue would sit idle with stock on the shelf.
    const plan = await service(
      [candidate("big", { quantity: 5 }), candidate("a"), candidate("b")],
      2,
    ).plan("book-1");

    expect(plan.ids).toEqual(["a", "b"]);
    expect(plan.skipped.map((row) => row.id)).toEqual(["big"]);
  });

  it("reports who was skipped, because a repeat skip needs a person", async () => {
    // Silent skipping is how a large entry waits forever while every wave
    // reports success.
    const plan = await service([candidate("big", { quantity: 9 })], 2).plan("book-1");

    expect(plan.skipped).toEqual([{ id: "big", name: "Person big", quantity: 9 }]);
    expect(plan.ids).toEqual([]);
  });

  it("plans nothing when the release is spent", async () => {
    const plan = await service([candidate("a")], 0).plan("book-1");

    expect(plan.ids).toEqual([]);
    expect(plan.quantity).toBe(0);
  });
});

describe("adminWaitlistOrder — the fairness rule", () => {
  function render(sort: Parameters<typeof adminWaitlistOrder>[0]): string {
    const dialect = new PgDialect();
    return adminWaitlistOrder(sort)
      .map((fragment) => dialect.sqlToQuery(fragment).sql)
      .join(", ");
  }

  it("puts everyone who has never had a turn ahead of anyone getting a second", async () => {
    // The clause that makes "they go back into the queue, behind those who
    // haven't had a turn yet" true. Without it a re-invited customer outranks
    // a first-timer who joined later, which reads as the shop favouring the
    // people it has already chased.
    const sql = render("fair");

    expect(sql).toMatch(/invite_attempts/);
    expect(sql.indexOf("invite_attempts")).toBeLessThan(sql.indexOf("created_at"));
  });

  it("falls back to signup order, the promise the form actually made", async () => {
    expect(render("fair")).toContain("created_at");
  });

  it("breaks ties on id, so paging cannot drop or repeat a person", async () => {
    // Offset pagination over a non-deterministic order silently skips rows,
    // and here a skipped row is somebody who never appears in any wave.
    for (const sort of ["fair", "oldest", "recent", "quantity-desc"] as const) {
      expect(render(sort)).toMatch(/"id"/);
    }
  });

  it("leaves `oldest` alone, since it answers a different question", async () => {
    // Staff scrolling by signup date are not filling a wave.
    expect(render("oldest")).not.toContain("invite_attempts");
  });
});
