import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  publicAvailableSql,
  reservedQuantitySql,
  ringfencedQuantitySql,
} from "../../src/inventory/reservations";

/**
 * What a stranger may buy, as SQL.
 *
 * `reservations.ts` opens by insisting there is exactly one definition of a
 * copy being spoken for, because the catalog card, the cart quote and the
 * guarded decrement all render from it and the shop oversells the moment they
 * disagree. That invariant is invisible to a unit test that stubs the query
 * chain — the fragment is never evaluated, so a subquery counting the wrong
 * rows passes every assertion about the numbers on top of it.
 *
 * So these render the real fragment through the real dialect and read it,
 * the way `waitlist-allocation.spec` does. The arithmetic itself was checked
 * against a live Postgres; what needs pinning here is the shape, and above all
 * that nobody quietly drops a term from the subtraction.
 */
function render(fragment: ReturnType<typeof sql>): string {
  return new PgDialect().sqlToQuery(fragment).sql;
}

const BOOK = sql`b.id`;

describe("ringfencedQuantitySql — copies set aside for the queue", () => {
  it("reads the open release only, so a closed one stops holding anything back", () => {
    const query = render(ringfencedQuantitySql(BOOK));

    expect(query).toContain("waitlist_allocations");
    expect(query).toContain("status = 'OPEN'");
  });

  it("is the release's own unspent budget: copies less what it has charged", () => {
    const query = render(ringfencedQuantitySql(BOOK));

    expect(query).toContain("wa.copies");
    expect(query).toContain("we.invite_allocation_id = wa.id");
  });

  it("charges a spent invite what was taken, not what was promised", () => {
    /* The ceiling-not-match rule from `chargedQuantitySql`. Somebody invited
       for two who ordered one has handed a copy back, and summing `quantity`
       for both cases is what leaves the release short of its own number. */
    const query = render(ringfencedQuantitySql(BOOK));

    expect(query).toContain("order_items");
    expect(query).toContain("we.invite_used_at is null then we.quantity");
  });

  it("counts spent and live invites alike, so a sale does not refill the budget", () => {
    // The half of the hold invariant that does not return stock. Only an
    // expiry or a withdrawal gives copies back, and both are absent by
    // construction rather than by a sweep that has to run.
    expect(render(ringfencedQuantitySql(BOOK))).toContain(
      "we.invite_used_at is not null or we.invite_expires_at > now()",
    );
  });

  it("floors at zero, so an overspent release cannot hand copies to the shelf", () => {
    // A release charged past its own `copies` — reachable when an admin lowers
    // the number under live holds — would otherwise go negative and *raise*
    // public availability, which is the opposite of what a ringfence is.
    expect(render(ringfencedQuantitySql(BOOK))).toContain("greatest(wa.copies");
  });

  it("is zero for a book with no open release, not an absence", () => {
    // `coalesce` around the whole subquery is what lets every caller subtract
    // this unconditionally. Without it a book that has never had a release
    // would make the whole expression null and the storefront would show
    // nothing at all as available.
    expect(render(ringfencedQuantitySql(BOOK))).toMatch(/^\s*coalesce\(\(/);
  });
});

describe("publicAvailableSql — the number the whole shop agrees on", () => {
  it("subtracts both what is held and what is set aside", () => {
    /* The regression this exists to prevent is a term going missing. A release
       used to appear nowhere in this expression at all, which is why a shop
       could set aside fifty copies at nine and sell all sixty by eleven. */
    const query = render(publicAvailableSql(sql`b.stock_quantity`, BOOK));

    expect(query).toContain("waitlist_allocations");
    expect(query).toContain("we.invite_token is not null");
  });

  it("floors at zero rather than reporting a negative allowance", () => {
    // An over-issued book must read as sold out. A negative would be accepted
    // by some later `>=` by accident, which is the expensive kind of quiet.
    expect(render(publicAvailableSql(sql`b.stock_quantity`, BOOK))).toContain("greatest(");
  });

  it("counts a live hold once, under the reservation and not again", () => {
    /* The two terms must not double-count the same copy, or an invited
       customer would be refused their own book: spending a token drops it out
       of the reservation and into the spent half of the release's charge, so
       the ringfence is unchanged and exactly one copy is freed. Pinned by
       shape here; verified numerically against Postgres. */
    const reserved = render(reservedQuantitySql(BOOK));

    expect(reserved).toContain("we.invite_used_at is null");
    expect(render(ringfencedQuantitySql(BOOK))).not.toContain("we.invite_token is not null");
  });
});
