import { describe, expect, it, vi } from "vitest";
import { AdminWaitlistService } from "../../src/admin/waitlist/admin-waitlist.service";

/**
 * Editing an entry's details — and the two cases where it must not.
 *
 * Staff can now correct the book, the quantity and the contact details of a
 * waitlist entry. Contact details are free to change in any state: getting one
 * wrong only wastes a text. The book and the quantity are not, because together
 * they *are* the hold — `reservedQuantitySql` and the allocation's `committed`
 * both read those two columns straight off the row, so editing either under a
 * live invite moves copies between budgets with nothing on screen to say so.
 *
 * These pin that the guard fires on the states that own copies, that an
 * ordinary correction still writes both the book and its title snapshot, and
 * that a title snapshot is never taken from the caller.
 */

const HOUR = 60 * 60 * 1000;

type Existing = Partial<{
  bookId: string | null;
  quantity: number;
  customerPhone: string;
  status: string;
  inviteUsedAt: Date | null;
  inviteExpiresAt: Date | null;
}>;

function makeService(existing: Existing = {}, clash: { customerName: string } | null = null) {
  /* What the update statement was actually asked to write — the assertion
     target for every "does it snapshot the title" test below. */
  let written: Record<string, unknown> | null = null;

  const entry = {
    id: "e1",
    status: "PENDING",
    internalNote: null,
    bookId: "book-old",
    bookTitleSnapshot: "N5 Kanji Book",
    quantity: 1,
    customerName: "Mina",
    customerEmail: "mina@example.com",
    customerPhone: "+8801700000000",
    locale: "bn",
    inviteUsedAt: null,
    inviteExpiresAt: null,
    ...existing,
  };

  const writer = () => ({
    set: (values: Record<string, unknown>) => {
      written = values;
      return { where: () => Promise.resolve() };
    },
  });

  const db = {
    query: {
      waitlistEntries: {
        /* Two different lookups share this mock: the entry itself asks for
           `status`, the duplicate check does not. */
        findFirst: vi
          .fn()
          .mockImplementation((args: { columns: Record<string, boolean> }) =>
            Promise.resolve(args.columns.status ? entry : clash),
          ),
      },
      books: {
        findFirst: vi.fn().mockResolvedValue({ id: "book-new", title: "N4 Grammar Book" }),
      },
    },
    update: writer,
    select: () => ({
      from: () => ({ leftJoin: () => ({ where: () => Promise.resolve([row()]) }) }),
    }),
    transaction: async (callback: (tx: unknown) => Promise<void>) => {
      await callback({ update: writer });
    },
  };

  const revoke = vi.fn().mockResolvedValue(undefined);

  const service = new AdminWaitlistService(
    { db } as never,
    { recordDetached: vi.fn().mockResolvedValue(undefined) } as never,
    { revoke } as never,
  );

  return { service, revoke, written: () => written };
}

/** The row the service re-reads to answer with. Its contents do not matter to
 *  these tests; the mapper needs the shape. */
function row() {
  return {
    id: "e1",
    bookId: "book-new",
    bookTitleSnapshot: "N4 Grammar Book",
    customerName: "Mina",
    customerEmail: "mina@example.com",
    customerPhone: "+8801700000000",
    quantity: 3,
    locale: "bn",
    source: "restock-notify-page",
    status: "PENDING",
    lane: "WAITING",
    notifiedAt: null,
    internalNote: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    convertedOrderNumber: null,
    inviteSmsStatus: null,
    inviteSmsError: null,
    inviteSmsAt: null,
    inviteMode: null,
    inviteExpiresAt: null,
    inviteUsedAt: null,
  };
}

const context = {
  actor: { sub: "admin-1", email: "staff@example.com" },
  ipAddress: null,
  userAgent: null,
} as never;

describe("AdminWaitlistService.update — editing the details", () => {
  it("writes the catalog's title alongside the book, never the caller's", async () => {
    // The snapshot is what the row displays once the book is deleted, so it
    // has to come from the same place the id does.
    const { service, written } = makeService();

    await service.update("e1", { bookId: "book-new" }, context);

    expect(written()).toMatchObject({ bookId: "book-new", bookTitleSnapshot: "N4 Grammar Book" });
  });

  it("clears the snapshot when an entry moves to the general list", async () => {
    const { service, written } = makeService();

    await service.update("e1", { bookId: null }, context);

    expect(written()).toMatchObject({ bookId: null, bookTitleSnapshot: null });
  });

  it("normalizes an edited phone to E.164, as the signup door does", async () => {
    // Everything downstream — the dedupe index, the SMS gateway, a staff
    // search — assumes one spelling.
    const { service, written } = makeService();

    await service.update("e1", { customerPhone: "01712345678" }, context);

    expect(written()).toMatchObject({ customerPhone: "+8801712345678" });
  });

  it("refuses a quantity change while an invite is live", async () => {
    const { service } = makeService({ inviteExpiresAt: new Date(Date.now() + HOUR) });

    await expect(service.update("e1", { quantity: 3 }, context)).rejects.toThrow(/holding a copy/i);
  });

  it("refuses a book change while an invite is live", async () => {
    const { service } = makeService({ inviteExpiresAt: new Date(Date.now() + HOUR) });

    await expect(service.update("e1", { bookId: "book-new" }, context)).rejects.toThrow(
      /holding a copy/i,
    );
  });

  it("refuses either once the invite has been spent", async () => {
    // The entry became an order. What was bought is a record, not a form.
    const { service } = makeService({
      status: "CONVERTED",
      inviteUsedAt: new Date(),
      inviteExpiresAt: new Date(Date.now() - HOUR),
    });

    await expect(service.update("e1", { quantity: 3 }, context)).rejects.toThrow(
      /already become an order/i,
    );
  });

  it("allows the same edits once the window has lapsed", async () => {
    // An expired unspent invite charges no release and reserves no copy —
    // `committedSql` and `reservedQuantitySql` both stop counting it — so
    // there is nothing left for the edit to move.
    const { service, written } = makeService({ inviteExpiresAt: new Date(Date.now() - HOUR) });

    await service.update("e1", { quantity: 3 }, context);

    expect(written()).toMatchObject({ quantity: 3 });
  });

  it("takes the dead invite with the entry when it moves to another book", async () => {
    // Otherwise the row keeps pointing at the old book's release and wave.
    const { service, revoke } = makeService({ inviteExpiresAt: new Date(Date.now() - HOUR) });

    await service.update("e1", { bookId: "book-new" }, context);

    expect(revoke).toHaveBeenCalledWith("e1", expect.anything());
  });

  it("leaves contact details editable in every state, including converted", async () => {
    const { service, written } = makeService({ status: "CONVERTED", inviteUsedAt: new Date() });

    await service.update("e1", { customerName: "Mina Rahman" }, context);

    expect(written()).toMatchObject({ customerName: "Mina Rahman" });
  });

  it("refuses to move an entry onto a book the same phone is already waiting on", async () => {
    // The partial unique index says the same thing; saying it here means a
    // name rather than a constraint violation.
    const { service } = makeService({}, { customerName: "Rafi" });

    await expect(service.update("e1", { bookId: "book-new" }, context)).rejects.toThrow(
      /Rafi is already on this book's list/,
    );
  });
});
