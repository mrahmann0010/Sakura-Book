import { notInArray, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { waitlistEntries } from "../db/schema";

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
  return sql`
    ${waitlistEntries.bookId} = ${bookId}
    and ${waitlistEntries.inviteToken} is not null
    and ${waitlistEntries.inviteUsedAt} is null
    and ${waitlistEntries.inviteExpiresAt} > now()
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
  const exclusion =
    excludeEntryIds && excludeEntryIds.length > 0
      ? sql` and ${notInArray(waitlistEntries.id, excludeEntryIds)}`
      : sql``;

  return sql<number>`coalesce((
    select sum(${waitlistEntries.quantity})
    from ${waitlistEntries}
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
