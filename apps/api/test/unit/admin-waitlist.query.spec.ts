import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { adminWaitlistQuerySchema } from "@sakura/contracts";
import { adminWaitlistFilters } from "../../src/admin/waitlist/admin-waitlist.query";

/**
 * The waitlist's `inviteState` filter — what the re-invite tab is built on.
 *
 * Fragments, not queries, rendered through the real dialect for the reason
 * admin-order.query.spec.ts sets out. The failure this guards against is the
 * expensive kind of silent: a filter that is one condition short matches
 * people who were never invited at all, and the screen it feeds sends SMS.
 */
function render(fragment: SQL | undefined): { sql: string; params: unknown[] } {
  const query = new PgDialect().sqlToQuery(fragment!);

  return { sql: query.sql, params: query.params };
}

const query = (overrides: Record<string, unknown> = {}) =>
  adminWaitlistQuerySchema.parse(overrides);

describe("adminWaitlistFilters — inviteState", () => {
  it("does not constrain on the token when the filter is absent", () => {
    // Every screen but the re-invite tab. A default that quietly required a
    // token would empty the main waitlist page.
    expect(adminWaitlistFilters(query())).toBeUndefined();
  });

  it("rejects a state outside the enum", () => {
    expect(() => adminWaitlistQuerySchema.parse({ inviteState: "used" })).toThrow();
  });

  it("requires a token to exist, not merely to be unspent", () => {
    // The whole point. `invite_used_at is null` is true of every entry that
    // was never invited, so on its own it would put first-timers into the
    // re-invite batch — and they would be texted a "here it is again" link.
    const { sql } = render(adminWaitlistFilters(query({ inviteState: "unused" })));

    expect(sql).toContain('"invite_token" is not null');
    expect(sql).toContain('"invite_used_at" is null');
  });

  it("leaves still-live links in the unused set", () => {
    // "unused" is the whole population the tab lists; expiry only decides
    // what is pre-selected. Filtering it here would hide the people staff
    // most often want to look at before deciding.
    expect(render(adminWaitlistFilters(query({ inviteState: "unused" }))).sql).not.toContain(
      "invite_expires_at",
    );
  });

  it("narrows to lapsed links on `expired`, keeping both token conditions", () => {
    const { sql } = render(adminWaitlistFilters(query({ inviteState: "expired" })));

    expect(sql).toContain('"invite_token" is not null');
    expect(sql).toContain('"invite_used_at" is null');
    expect(sql).toContain('"invite_expires_at" <= now()');
  });

  it("compares expiry against the database clock, not a bound timestamp", () => {
    // `now()` rather than a JS `new Date()`: the list and its status counts
    // are two round trips, and a row expiring between them would otherwise
    // appear in one and not the other.
    expect(render(adminWaitlistFilters(query({ inviteState: "expired" }))).params).toEqual([]);
  });

  it("combines with the status filter rather than replacing it", () => {
    // The tab asks for both: PENDING or NOTIFIED *and* holding a dead token.
    const { sql } = render(
      adminWaitlistFilters(query({ status: ["PENDING", "NOTIFIED"], inviteState: "unused" })),
    );

    expect(sql).toContain('"status" in');
    expect(sql).toContain('"invite_token" is not null');
  });

  it("survives the status-count pass, which drops only the status condition", () => {
    // `skipStatus` exists so the tab numbers count the same rows the table
    // shows. If it dropped the invite filter too, the counts above a
    // re-invite list would silently describe the whole waitlist.
    const { sql } = render(
      adminWaitlistFilters(query({ status: ["NOTIFIED"], inviteState: "expired" }), {
        skipStatus: true,
      }),
    );

    expect(sql).not.toContain('"status" in');
    expect(sql).toContain('"invite_expires_at" <= now()');
  });
});
