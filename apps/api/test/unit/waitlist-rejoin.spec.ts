import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { DuplicateResourceError } from "../../src/common/errors";
import { waitlistEntries } from "../../src/db/schema";
import { WaitlistService } from "../../src/waitlist/waitlist.service";

/**
 * Buying does not cost you your place in the next queue.
 *
 * Uniqueness on a waitlist entry used to be (phone, book) with no opinion
 * about status, so an entry held its slot for good. The person that locked
 * out was always the same one: the customer who waited, answered the SMS and
 * bought. Their own purchase is what held the slot, so the first reprint of
 * any title would turn away exactly the people who had proved they wanted it
 * — and turn them away with "you're already on this list", about a list that
 * is no longer serving them.
 *
 * CANCELLED still blocks, and the asymmetry is the rule rather than an
 * oversight: converting is the queue working, cancelling is somebody asking
 * to be taken off it, and Cancel is the only do-not-contact tool the shop
 * has. These pin both halves, and — more importantly — pin them to *each
 * other*, since the rule is written twice.
 */

function makeService(existing: { id: string } | undefined) {
  const wheres: unknown[] = [];

  const db = {
    query: {
      books: {
        findFirst: vi.fn().mockResolvedValue({ id: "book-1", title: "N5 Kanji Book" }),
      },
      waitlistEntries: {
        findFirst: vi.fn().mockImplementation(({ where }: { where: unknown }) => {
          wheres.push(where);
          return Promise.resolve(existing);
        }),
      },
    },
    insert: () => ({
      values: (row: Record<string, unknown>) => ({
        returning: () =>
          Promise.resolve([
            {
              id: "new-entry",
              status: "PENDING",
              bookTitle: row.bookTitleSnapshot,
              createdAt: new Date("2026-09-11T00:00:00Z"),
            },
          ]),
      }),
    }),
  };

  return { service: new WaitlistService({ db } as never), wheres };
}

const signup = {
  bookId: "book-1",
  fullName: "Mina",
  email: "mina@example.com",
  phone: "01711111111",
  quantity: 1,
  locale: "bn",
  source: "restock-notify-page",
} as never;

/** The rendered SQL of a drizzle fragment, for asserting on its shape. */
function render(fragment: unknown): string {
  return new PgDialect().sqlToQuery(fragment as never).sql;
}

describe("WaitlistService.subscribe — rejoining after a purchase", () => {
  it("does not count a converted entry as a duplicate", async () => {
    /* The whole fix, as one assertion on the query: the lookup that decides
       "are you already on this list" must not see the row recording that they
       bought last time. */
    const { service, wheres } = makeService(undefined);

    await service.subscribe(signup);

    expect(render(wheres[0])).toMatch(/"status"\s*<>/);
  });

  it("still refuses a second live signup for the same book", async () => {
    const { service } = makeService({ id: "existing" });

    await expect(service.subscribe(signup)).rejects.toBeInstanceOf(DuplicateResourceError);
  });

  it("files the rejoin as a new entry rather than reviving the old one", async () => {
    /* `created_at` is the fairness key the whole queue is ordered by, so
       resetting the old row would seat a returning customer ahead of everyone
       who signed up while they were away — and erase the earlier purchase to
       do it. A fresh row starts at the back, with invite_attempts at zero,
       which is the truth: no turn taken in *this* print run. */
    const { service } = makeService(undefined);

    const entry = await service.subscribe(signup);

    expect(entry.id).toBe("new-entry");
    expect(entry.status).toBe("PENDING");
  });
});

describe("the rule is written twice and the two must agree", () => {
  /* The query is the half that produces a kind message; the partial unique
     index is the half that is actually enforced. Drift either way is bad, but
     one direction is invisible from outside: a query stricter than the index
     refuses signups the database would have accepted, and tells the customer
     they are on a list they are not on. */
  const indexes = getTableConfig(waitlistEntries).indexes;

  const predicateOf = (name: string) => {
    const found = indexes.find((index) => index.config.name === name);
    if (!found?.config.where) throw new Error(`${name} has no predicate`);
    return render(found.config.where);
  };

  it("excludes converted entries from the per-book uniqueness index", () => {
    const predicate = predicateOf("waitlist_entries_phone_book_idx");

    expect(predicate).toContain("'CONVERTED'");
    expect(predicate).toMatch(/"book_id"\s+is not null/);
  });

  it("excludes them from the legacy book-less index too", () => {
    const predicate = predicateOf("waitlist_entries_phone_general_idx");

    expect(predicate).toContain("'CONVERTED'");
    expect(predicate).toMatch(/"book_id"\s+is null/);
  });

  it("does not let cancelled entries out of either index", () => {
    /* The asymmetry, pinned so that "make cancelled behave like converted"
       has to be a decision somebody takes deliberately rather than a tidy-up
       that looks like symmetry. */
    expect(predicateOf("waitlist_entries_phone_book_idx")).not.toContain("CANCELLED");
    expect(predicateOf("waitlist_entries_phone_general_idx")).not.toContain("CANCELLED");
  });
});
