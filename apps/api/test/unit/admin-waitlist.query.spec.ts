import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { adminWaitlistQuerySchema } from "@sakura/contracts";
import { adminWaitlistFilters } from "../../src/admin/waitlist/admin-waitlist.query";
import { waitlistLaneSql } from "../../src/waitlist";

/**
 * The waitlist's `lane` filter — what every tab in the panel is built on.
 *
 * Fragments, not queries, rendered through the real dialect for the reason
 * admin-order.query.spec.ts sets out. The failure this guards against is the
 * expensive kind of silent: a lane that is one condition short matches people
 * who were never invited at all, and the screens it feeds send SMS.
 */
function render(fragment: SQL | undefined): { sql: string; params: unknown[] } {
  const query = new PgDialect().sqlToQuery(fragment!);

  return { sql: query.sql, params: query.params };
}

const query = (overrides: Record<string, unknown> = {}) =>
  adminWaitlistQuerySchema.parse(overrides);

describe("waitlistLaneSql", () => {
  it("holds a copy under exactly the condition the storefront releases one under", () => {
    // The invariant the whole module exists for: a copy is off the public
    // shelf if and only if its entry is INVITED. `reservations.ts` matches on
    // token-present, unspent and unexpired, so the lane must too — one
    // condition short here and the panel would show a copy as free while the
    // catalog still withheld it, or the reverse.
    const { sql } = render(waitlistLaneSql());

    expect(sql).toContain('"invite_token" is not null');
    expect(sql).toContain('"invite_used_at" is null');
    expect(sql).toContain('"invite_expires_at" <= now()');
  });

  it("reads the clock in Postgres, never as a bound timestamp", () => {
    // `now()` rather than a JS `new Date()`: a list and the counts above it
    // are two round trips, and a row lapsing between them would otherwise be
    // in one and not the other.
    expect(render(waitlistLaneSql()).params).toEqual([]);
  });

  it("settles the terminal lanes before consulting the token", () => {
    // A cancelled entry whose token has not yet been revoked is still
    // cancelled, and a converted one keeps the spent token it converted with.
    // If the token branches ran first, either could be reported as holding a
    // copy it is not.
    const { sql } = render(waitlistLaneSql());
    const cancelled = sql.indexOf("'CANCELLED'");
    const converted = sql.indexOf("'CONVERTED'");
    const token = sql.indexOf('"invite_token"');

    expect(cancelled).toBeGreaterThanOrEqual(0);
    expect(cancelled).toBeLessThan(token);
    expect(converted).toBeLessThan(token);
  });
});

describe("adminWaitlistFilters — lane", () => {
  it("does not constrain on the lane when the filter is absent", () => {
    // A default that quietly required a lane would empty every screen that
    // does not pass one, the CSV export included.
    expect(adminWaitlistFilters(query())).toBeUndefined();
  });

  it("rejects a lane outside the enum", () => {
    expect(() => adminWaitlistQuerySchema.parse({ lane: ["PENDING"] })).toThrow();
  });

  it("accepts a single lane unwrapped, the way a query string arrives", () => {
    // One occurrence of `?lane=` is a string, two are an array. A schema that
    // took only the array form would break on every single-tab request.
    expect(adminWaitlistQuerySchema.parse({ lane: "EXPIRED" }).lane).toEqual(["EXPIRED"]);
  });

  it("matches several lanes at once for the re-invite batch", () => {
    // The one screen that needs two: everyone holding an unspent link,
    // whether or not its window has closed.
    const { sql, params } = render(adminWaitlistFilters(query({ lane: ["INVITED", "EXPIRED"] })));

    expect(sql).toContain("in (");
    expect(params).toEqual(["INVITED", "EXPIRED"]);
  });

  it("combines with the status filter rather than replacing it", () => {
    // Lane and status answer different questions and both remain available:
    // "reached at some point" is still a thing staff can ask for on its own.
    const { sql } = render(adminWaitlistFilters(query({ status: ["NOTIFIED"], lane: ["EXPIRED"] })));

    expect(sql).toContain('"status" in');
    expect(sql).toContain('"invite_expires_at" <= now()');
  });

  it("survives the tab-count pass, which drops only the lane condition", () => {
    // `skipLane` exists so the tab numbers count the same rows the table
    // shows. If it dropped the other filters too, the counts above a
    // book-filtered list would silently describe the whole waitlist.
    const { sql, params } = render(
      adminWaitlistFilters(query({ status: ["NOTIFIED"], lane: ["EXPIRED"] }), { skipLane: true }),
    );

    expect(sql).toContain('"status" in');
    expect(sql).not.toContain('"invite_expires_at" <= now()');
    expect(params).toEqual(["NOTIFIED"]);
  });

  it("treats an empty lane array as no lane filter", () => {
    // `?lane=` with nothing after it. A clause built from zero members would
    // render `in ()` and match nothing, emptying the screen instead of
    // leaving it unfiltered.
    expect(adminWaitlistFilters(query({ lane: [] }))).toBeUndefined();
  });
});
