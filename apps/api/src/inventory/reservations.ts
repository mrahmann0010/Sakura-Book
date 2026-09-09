import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/* --------------------------------------------------------------------------
   What a copy being "spoken for" means, defined once.

   A print run is not the same thing as a shelf the public may take from. Sixty
   copies with sixty live invites against them is sixty copies that are already
   promised, and the number a stranger is allowed to buy from is the difference
   between the two — not the stock count, which is what it used to be and is
   why an invited customer could be beaten to their own copy by whoever
   happened to be browsing.

   Everything below exists so that difference has exactly one definition. The
   cart quote renders from it, the catalog card renders from it, and the
   guarded UPDATE at checkout enforces it; if those three ever disagree the
   shop oversells, so they are not allowed to be three separate expressions of
   the same idea.
   -------------------------------------------------------------------------- */

/**
 * A reservation is live for precisely as long as its token could still be
 * spent.
 *
 * These are the same three conditions `WaitlistInviteService.redeem` and
 * `.consume` match on, and that is the point rather than a coincidence: a copy
 * is held back if and only if someone can still walk up and claim it. Were
 * this list to drift from those two — an extra status check here, a missing
 * expiry there — the shop would either hold copies nobody can claim or release
 * copies someone still can.
 *
 * `invite_expires_at` doing the work in SQL is what makes a lapsed invite
 * return its copy to the public at the moment it lapses, with no sweep to run
 * and nothing to schedule. There is deliberately no `status` clause: status
 * says how far along the *conversation* with that customer got, which is a
 * different question from whether a copy is still owed.
 */
function liveInviteConditions(bookId: PgColumn | SQL): SQL {
  /* The inner table is written as raw `we.` text rather than through
     `waitlistEntries`' column objects, and that is load-bearing.

     Inside a relational query — `db.query.books.findMany({ extras })`, which is
     how the catalog and pricing both read this — drizzle rewrites every column
     reference in the fragment to the *outer* query's alias. Passing
     `waitlistEntries.quantity` here produced `"books"."quantity"`, and the
     whole catalog answered 500 with `column books.quantity does not exist`.
     Raw identifiers are left alone, so they survive the rewrite.

     `${bookId}` stays a real column reference on purpose: it is the outer
     correlation, and being re-aliased to the enclosing query is exactly what it
     is for. */
  return sql`
    we.book_id = ${bookId}
    and we.invite_token is not null
    and we.invite_used_at is null
    and we.invite_expires_at > now()
  `;
}

/**
 * Copies promised but not yet collected, as a scalar subquery.
 *
 * Sums `quantity` rather than counting rows, because a waitlist entry can ask
 * for more than one copy and three people holding two each is six copies off
 * the shelf, not three.
 *
 * Counted from the invite rows on every read instead of being kept in a column
 * on `books`. A stored total would be faster and would eventually be wrong:
 * every issue, redemption, expiry and purge would have to remember to adjust
 * it, and the first one that forgot would either strand copies or oversell
 * them — silently, and in a way no later query could detect. The subquery
 * cannot drift from the invites because it *is* the invites, and
 * `waitlist_entries_book_id_idx` is what keeps it cheap.
 */
export function reservedQuantitySql(
  bookId: PgColumn | SQL,
  options: { excludeEntryIds?: string[] } = {},
): SQL<number> {
  const { excludeEntryIds } = options;

  /* Used when the caller is about to rewrite these very entries' invites and
     needs to know what everyone *else* is holding. Re-inviting someone whose
     link lapsed replaces the token on their existing row rather than adding a
     row, so counting their old reservation and then charging them for a new
     one would bill the same person's copies twice and refuse a batch that
     fits. */
  /* Raw `we.id`, for the aliasing reason above: `notInArray(waitlistEntries.id,
     ...)` would be rewritten to the outer table the moment this is used inside
     a relational query.

     One bound parameter per id rather than a single array parameter. Drizzle
     binds a JS array into `sql` as a record, so `= any(${ids}::uuid[])` fails
     with "cannot cast type record to uuid[]" — the ids still travel as
     parameters here, just individually. */
  const exclusion =
    excludeEntryIds && excludeEntryIds.length > 0
      ? sql` and we.id not in (${sql.join(
          excludeEntryIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`
      : sql``;

  return sql<number>`coalesce((
    select sum(we.quantity)
    from waitlist_entries we
    where ${liveInviteConditions(bookId)}${exclusion}
  ), 0)::int`;
}

/**
 * What a member of the public may buy: the print run, less what is owed.
 *
 * Floored at zero so an over-issued book — more invites out than copies in,
 * which an admin lowering the stock count can create at any time — reads as
 * "sold out" rather than as a negative allowance that some later `>=` accepts
 * by accident. The over-issue itself is a real problem, but it is the
 * waitlist's to report and an admin's to resolve; the storefront's only
 * correct behaviour is to sell nobody anything.
 */
export function publicAvailableSql(stock: PgColumn | SQL, bookId: PgColumn | SQL): SQL<number> {
  return sql<number>`greatest(${stock} - ${reservedQuantitySql(bookId)}, 0)`;
}
