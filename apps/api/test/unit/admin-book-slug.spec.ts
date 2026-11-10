import { describe, expect, it, vi } from "vitest";
import { AdminBooksService } from "../../src/admin/catalog/admin-books.service";
import { ResourceConflictError } from "../../src/common/errors";

/**
 * Who may hold a given URL.
 *
 * A book's slug is editable (see `adminBookUpdateRequestSchema`), which makes
 * two books racing for one URL newly possible. The column is unique, so the
 * database would refuse the second either way — but as a driver error, which
 * reaches the operator as a blank "something went wrong" next to the field
 * they just typed. These tests pin the early check that turns it into a
 * sentence naming the book already using that URL.
 *
 * The slug the book already has is the case worth guarding hardest: a form
 * that posts every field re-sends it on every save, and treating that as a
 * collision with itself would make the book uneditable.
 */

const BOOK_ID = "11111111-1111-1111-1111-111111111111";

/** Reached the transaction — i.e. got past the slug check. */
const PAST_THE_CHECK = new Error("reached the transaction");

function service(existingSlug: string, slugOwner: { id: string; title: string } | null) {
  const findFirst = vi.fn(async ({ where }: { where?: unknown } = {}) =>
    /* Two different reads go through `db.query.books.findFirst` here:
       `requireBook`, which is given the id, and the slug lookup. The fake
       cannot inspect a drizzle `where` expression, so it answers in call
       order: first the book being edited, then whoever holds the slug. */
    findFirst.mock.calls.length === 1
      ? { id: BOOK_ID, slug: existingSlug, title: "N4", authors: [], categories: [] }
      : slugOwner,
  );

  const db = {
    query: { books: { findFirst } },
    /* Nothing past the slug check is under test, and faking a whole drizzle
       transaction to prove it would test the fake. */
    transaction: vi.fn(() => Promise.reject(PAST_THE_CHECK)),
  };

  return new AdminBooksService({ db } as never, { record: vi.fn() } as never);
}

const actor = { sub: "u1", email: "owner@shop.com" };

describe("AdminBooksService.update — renaming a slug", () => {
  it("refuses a slug another book already holds, naming that book", async () => {
    const books = service("n4", { id: "22222222-2222-2222-2222-222222222222", title: "JLPT N4" });

    await expect(books.update(BOOK_ID, { slug: "listening-n4" }, actor)).rejects.toThrow(
      /already used by "JLPT N4"/,
    );
  });

  it("refuses it as a conflict, so the API answers 409 rather than 500", async () => {
    const books = service("n4", { id: "22222222-2222-2222-2222-222222222222", title: "JLPT N4" });

    await expect(books.update(BOOK_ID, { slug: "listening-n4" }, actor)).rejects.toBeInstanceOf(
      ResourceConflictError,
    );
  });

  it("allows a free slug", async () => {
    const books = service("n4", null);

    await expect(books.update(BOOK_ID, { slug: "listening-n4" }, actor)).rejects.toBe(
      PAST_THE_CHECK,
    );
  });

  it("does not treat the book's own slug as a collision with itself", async () => {
    // The owner of "n4" *is* this book. A form re-sending every field must
    // still be able to save a price change.
    const books = service("n4", { id: BOOK_ID, title: "N4" });

    await expect(books.update(BOOK_ID, { slug: "n4", priceCents: 50000 }, actor)).rejects.toBe(
      PAST_THE_CHECK,
    );
  });
});
