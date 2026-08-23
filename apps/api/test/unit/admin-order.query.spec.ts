import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { adminOrderQuerySchema, orderStatuses } from "@sakura/contracts";
import { adminOrderFilters, adminOrderOrder } from "../../src/admin/orders/admin-order.query";

/**
 * The order queue's filters and sort.
 *
 * Fragments, not queries — same split as catalog/book.query.ts, and testable
 * without a database for the same reason. The failures these guard against are
 * all silent: a filter that quietly matches everything, a date range that
 * excludes its own last day, a sort that drops orders between pages.
 */
describe("adminOrderQuerySchema", () => {
  it("accepts a single status as one-element array", () => {
    // `?status=PENDING` arrives as a string; `?status=A&status=B` as an array.
    // A schema that only handles one of those breaks in whichever case the
    // developer did not click through.
    const parsed = adminOrderQuerySchema.parse({ status: "PENDING" });

    expect(parsed.status).toEqual(["PENDING"]);
  });

  it("accepts repeated statuses, so one query covers the whole work queue", () => {
    const parsed = adminOrderQuerySchema.parse({ status: ["PAYMENT_CONFIRMED", "PROCESSING"] });

    expect(parsed.status).toEqual(["PAYMENT_CONFIRMED", "PROCESSING"]);
  });

  it("rejects a status that is not in the lifecycle", () => {
    expect(() => adminOrderQuerySchema.parse({ status: "PACKED" })).toThrow();
  });

  it("defaults to newest-first, because the queue is a work list", () => {
    expect(adminOrderQuerySchema.parse({}).sort).toBe("recent");
  });

  it("caps page size, so one request cannot ask for every order ever placed", () => {
    expect(() => adminOrderQuerySchema.parse({ pageSize: 5000 })).toThrow();
  });
});

/**
 * Render a fragment the way the driver will.
 *
 * `JSON.stringify` cannot be used to inspect these — a fragment holds
 * references to the table objects it was built from, and those are circular.
 * Going through the real dialect is better than walking the chunk tree anyway:
 * it asserts against the SQL and the bound parameters that Postgres would
 * actually receive, rather than against Drizzle's internal representation of
 * them, which is free to change in a patch release.
 */
function render(fragment: SQL | undefined): { sql: string; params: unknown[] } {
  const query = new PgDialect().sqlToQuery(fragment!);

  return { sql: query.sql, params: query.params };
}

describe("adminOrderFilters", () => {
  const query = (overrides: Record<string, unknown> = {}) =>
    adminOrderQuerySchema.parse(overrides);

  it("applies no constraint when nothing is filtered", () => {
    // An unfiltered queue must return every order — including cancelled and
    // refunded ones. Unlike the catalog there is no row staff may not see.
    expect(adminOrderFilters(query())).toBeUndefined();
  });

  it("builds a constraint once any filter is present", () => {
    expect(adminOrderFilters(query({ status: "PENDING" }))).toBeDefined();
    expect(adminOrderFilters(query({ q: "NB-40718" }))).toBeDefined();
    expect(adminOrderFilters(query({ paymentMethod: "cash-on-delivery" }))).toBeDefined();
  });

  it("escapes wildcards typed into the search box", () => {
    // An unescaped `%` would match every order in the shop, which reads as a
    // broken filter rather than as the wildcard it is.
    expect(render(adminOrderFilters(query({ q: "100%" }))).params).toContain("%100\\%%");
  });

  it("escapes an underscore, which would otherwise match any character", () => {
    // Anchored to the start for the order number, since it is typed in whole
    // off a printed confirmation — and carrying the escape either way.
    expect(render(adminOrderFilters(query({ q: "NB_40718" }))).params).toContain("NB\\_40718%");
  });

  it("includes the whole of the last day in a date range", () => {
    // `placedTo=2026-08-20` means "up to and including the 20th". Comparing
    // against that day's midnight would silently drop every order placed on
    // the last day of the range — the most recent ones, and the ones the
    // search was for.
    const bounds = render(adminOrderFilters(query({ placedTo: "2026-08-20" }))).params;

    expect(bounds).toContain("2026-08-20T23:59:59.999Z");
    expect(bounds).not.toContain("2026-08-20T00:00:00.000Z");
  });

  it("starts a date range at the beginning of the first day", () => {
    expect(render(adminOrderFilters(query({ placedFrom: "2026-08-20" }))).params).toContain(
      "2026-08-20T00:00:00.000Z",
    );
  });
});

describe("adminOrderOrder", () => {
  it("always ends in a stable tiebreak", () => {
    // Two orders placed in the same second is routine during a promotion, and
    // a fulfilment queue that drops one between pages is an order that never
    // ships.
    for (const sort of ["recent", "oldest", "total-desc"] as const) {
      expect(adminOrderOrder(sort).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("falls back to newest-first for an unknown sort", () => {
    expect(adminOrderOrder("nonsense" as never)).toHaveLength(2);
  });
});

describe("contract coverage", () => {
  it("filters accept every status the lifecycle defines", () => {
    // Guards the same drift the machine's own test guards from the other side:
    // a status added to the enum must be filterable, or it becomes an order
    // staff cannot find.
    for (const status of orderStatuses) {
      expect(() => adminOrderQuerySchema.parse({ status })).not.toThrow();
    }
  });
});
