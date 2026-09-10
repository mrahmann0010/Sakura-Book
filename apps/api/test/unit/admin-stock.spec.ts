import { describe, expect, it, vi } from "vitest";
import { AdminStockService } from "../../src/admin/stock/admin-stock.service";

/**
 * The stock screen's ordering, which is its editorial position.
 *
 * The rows themselves are a read of expressions that already exist elsewhere
 * and are pinned there. What is new here is the judgement about which ones a
 * person needs to see first — and that judgement is the whole reason the
 * screen was built, since the failure it exists to prevent is a book that
 * refuses every invite sitting quietly among books that are fine.
 */
function service(rows: Record<string, unknown>[]) {
  const db = {
    select: vi.fn().mockReturnValue({
      from: () => ({
        leftJoin: () => ({
          where: () => ({ orderBy: () => Promise.resolve(rows) }),
        }),
      }),
    }),
  };

  return new AdminStockService({ db } as never);
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    bookId: "11111111-1111-1111-1111-111111111111",
    title: "A Title",
    slug: "a-title",
    onHand: 60,
    promised: 0,
    reserved: 0,
    onShelf: 60,
    waiting: 0,
    waitingQuantity: 0,
    allocationId: null,
    allocationCopies: null,
    ...overrides,
  };
}

describe("AdminStockService.list — what a manager sees first", () => {
  it("puts an over-issued book above everything, since the shop cannot sell it at all", async () => {
    const { items } = await service([
      row({ title: "Fine", onHand: 10 }),
      row({ title: "Broken", onHand: 5, promised: 12 }),
    ]).list();

    expect(items[0]!.title).toBe("Broken");
    expect(items[0]!.overIssued).toBe(true);
  });

  it("flags a queue nobody has funded, which is the failure that has no other symptom", async () => {
    /* The bug this screen was built for. Every invite for such a book is
       refused before a text is attempted, so nothing is logged against the
       entry and the row looks untouched — staff press Invite and watch
       nothing happen. */
    const { items } = await service([
      row({ title: "Zebra", waiting: 47, allocationId: null }),
      row({ title: "Apple", waiting: 0 }),
    ]).list();

    expect(items[0]!.title).toBe("Zebra");
  });

  it("ranks a broken book above an unfunded queue: one is losing sales now", async () => {
    const { items } = await service([
      row({ title: "Unfunded", waiting: 9, allocationId: null }),
      row({ title: "Overissued", onHand: 2, promised: 9 }),
    ]).list();

    expect(items.map((item) => item.title)).toEqual(["Overissued", "Unfunded"]);
  });

  it("sorts the untroubled rest alphabetically rather than by whatever the query returned", async () => {
    const { items } = await service([
      row({ title: "Cherry" }),
      row({ title: "Apple" }),
      row({ title: "Banana" }),
    ]).list();

    expect(items.map((item) => item.title)).toEqual(["Apple", "Banana", "Cherry"]);
  });

  it("does not call a book over-issued merely for having a release open", async () => {
    // Reserved copies are set aside, not promised to anybody yet. Confusing
    // the two would paint a healthy restock red on the morning it is opened.
    const { items } = await service([
      row({
        onHand: 60,
        promised: 0,
        reserved: 50,
        onShelf: 10,
        allocationId: "a",
        allocationCopies: 50,
      }),
    ]).list();

    expect(items[0]!.overIssued).toBe(false);
  });

  it("reads over-issue from the copies themselves, so a closed release still counts", async () => {
    /* Invites outlive the release they were charged to — closing one leaves
       its holds alone by design. A book can therefore be over-issued while
       holding no open release at all, which is why this is computed from
       stock and promised rather than taken from the allocation. */
    const { items } = await service([
      row({ onHand: 3, promised: 8, allocationId: null, allocationCopies: null }),
    ]).list();

    expect(items[0]!.overIssued).toBe(true);
  });
});

describe("AdminStockService.list — a release that has sold through", () => {
  it("flags an open release with nothing left and copies free on the shelf", async () => {
    /* The trap: stock 1, share 1, invite one person, they buy. Restock to 1
       and set the share to 1 again and nothing happens — a copy that sells
       stays charged to the release that sold it, so the release never refills
       and the number was never the problem. Indistinguishable from a healthy
       release until this flag. */
    const { items } = await service([
      row({
        onHand: 1,
        promised: 0,
        reserved: 0,
        onShelf: 1,
        allocationId: "a",
        allocationCopies: 1,
      }),
    ]).list();

    expect(items[0]!.releaseSpent).toBe(true);
  });

  it("does not flag a release that is merely waiting on stock", async () => {
    // Nothing left to give and nothing on the shelf to give: the answer is a
    // delivery, not a new release, and closing this one would help nobody.
    const { items } = await service([
      row({
        onHand: 0,
        promised: 0,
        reserved: 0,
        onShelf: 0,
        allocationId: "a",
        allocationCopies: 5,
      }),
    ]).list();

    expect(items[0]!.releaseSpent).toBe(false);
  });

  it("does not flag a release whose copies are out on live invites", async () => {
    // Those copies are spoken for but not gone — the holds can still lapse and
    // hand them back to this same release. Replacing it would charge the shop
    // twice for the same books.
    const { items } = await service([
      row({
        onHand: 10,
        promised: 4,
        reserved: 6,
        onShelf: 0,
        allocationId: "a",
        allocationCopies: 10,
      }),
    ]).list();

    expect(items[0]!.releaseSpent).toBe(false);
  });

  it("ranks a spent release with the unfunded queues, since neither can send", async () => {
    const { items } = await service([
      row({
        title: "Healthy",
        onHand: 9,
        reserved: 9,
        onShelf: 0,
        allocationId: "a",
        allocationCopies: 9,
      }),
      row({
        title: "Spent",
        onHand: 1,
        reserved: 0,
        onShelf: 1,
        waiting: 4,
        allocationId: "b",
        allocationCopies: 1,
      }),
    ]).list();

    expect(items[0]!.title).toBe("Spent");
  });
});
