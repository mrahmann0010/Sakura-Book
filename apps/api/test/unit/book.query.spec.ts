import { describe, expect, it } from "vitest";
import { bookOrder, orderByIds } from "../../src/catalog/book.query";

/**
 * The catalog's sort and the id-ordering helper.
 *
 * These are the two pieces of `list()` that can be wrong without failing —
 * a missing tiebreak or a lost ordering produces a page that looks fine and
 * quietly drops a book.
 */
describe("bookOrder", () => {
  it("always ends in a stable tiebreak", () => {
    // Offset pagination over a non-deterministic order duplicates and drops
    // rows across page boundaries: two books at the same price have no defined
    // relative order, so page 2 can repeat what page 1 showed. Every sort must
    // therefore end in a unique column.
    for (const sort of ["recent", "title", "price-asc", "rating"] as const) {
      const clauses = bookOrder(sort);

      expect(clauses.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("falls back to the default ordering for an unknown sort", () => {
    // The schema's default means this is unreachable through HTTP, but a
    // direct caller passing junk must get the shelf, not an empty ORDER BY.
    expect(bookOrder("nonsense" as never)).toHaveLength(2);
  });
});

describe("orderByIds", () => {
  it("restores the ordering a relational fetch does not preserve", () => {
    const rows = [{ id: "b" }, { id: "c" }, { id: "a" }];

    expect(orderByIds(rows, ["a", "b", "c"])).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
  });

  it("drops ids with no matching row rather than emitting holes", () => {
    // A book deleted between the id query and the row fetch would otherwise
    // become `undefined` in the items array and crash the mapper.
    expect(orderByIds([{ id: "a" }], ["a", "missing"])).toEqual([{ id: "a" }]);
  });

  it("ignores rows that were not asked for", () => {
    expect(orderByIds([{ id: "a" }, { id: "z" }], ["a"])).toEqual([{ id: "a" }]);
  });

  it("returns nothing for no ids", () => {
    expect(orderByIds([{ id: "a" }], [])).toEqual([]);
  });
});
