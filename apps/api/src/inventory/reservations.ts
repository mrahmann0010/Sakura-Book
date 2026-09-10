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
 * What one invite costs its release: promised while live, taken once spent.
 *
 * Two different questions wearing the same word. While a hold is live the
 * charge is what was *promised* — `quantity`, the copies nobody else may be
 * offered. Once the invite is spent the charge is what was *taken*, and those
 * are not the same number: an invite's quantity is a ceiling, not an exact
 * match (see `CheckoutService.consumeInvite`), so somebody invited for two who
 * ordered one has returned a copy to the shop.
 *
 * Summing `quantity` in both cases is what this replaces, and it leaked in one
 * direction only: the unbought copy went back on the public shelf the instant
 * the token was spent — `reservedQuantitySql` stops counting a spent invite —
 * while the release went on being charged for it until it was closed. The
 * shelf and the budget disagreed about the same copy, and the budget was the
 * one nobody could see was wrong. On a restock where a third of invitees take
 * fewer than they asked for, that is the release quietly running short of its
 * own number.
 *
 * The fallback is the deleted-order case. `converted_order_id` is `set null` on
 * delete, so an order removed after the fact would otherwise turn a real charge
 * into zero and hand the release copies that were genuinely sold. Falling back
 * to `quantity` keeps the pre-existing (conservative) answer for a row whose
 * order is gone.
 *
 * Lives here rather than beside the release arithmetic that reads it, because
 * the ringfence below needs the same definition and this file is where "what a
 * copy costs" is settled once. Raw `we.` / `oi.` identifiers throughout, for
 * the aliasing reason `reservedQuantitySql` sets out.
 */
export function chargedQuantitySql(): SQL<number> {
  return sql<number>`case
    when we.invite_used_at is null then we.quantity
    else coalesce((
      select sum(oi.quantity)
      from order_items oi
      where oi.order_id = we.converted_order_id
        and oi.book_id = we.book_id
    ), we.quantity)
  end`;
}

/**
 * Copies set aside for the queue that have not been handed to anyone yet.
 *
 * The open release's own budget, less what it has spent: `copies − committed`,
 * which is the same `remaining` the admin panel renders. Zero when the book
 * has no open release, which is what makes this safe to subtract everywhere
 * unconditionally.
 *
 * This is the fix for a gap that made the whole feature a half-promise. A
 * release used to be a cap on what *staff* could hand out and nothing more —
 * it appeared nowhere in what the public could buy. So a shop that set aside
 * fifty copies for the queue at nine o'clock could sell all sixty to walk-ins
 * by eleven, and every invite issued afterwards would be refused for lack of
 * physical stock. The manager had been shown a number that read like a
 * reservation and behaved like a note-to-self.
 *
 * Subtracting it here makes the set-aside real: the copies leave the public
 * shelf when the decision is made, not when the texts go out.
 *
 * An invited customer is still admitted, and by arithmetic rather than by an
 * exemption — the same property `InventoryService.decrement` already relied on.
 * Spending their token moves their copy out of `reservedQuantitySql` and into
 * the spent half of `committed`, which leaves `copies − committed` unchanged.
 * The copy they take comes out of the ringfence they were always inside, and
 * the two terms never double-count it.
 */
export function ringfencedQuantitySql(bookId: PgColumn | SQL): SQL<number> {
  /* Raw `wa.` and `we.` identifiers for the aliasing reason above: this is read
     from inside `db.query.books.findMany({ extras })`, which rewrites every
     column object it can see to the outer query's alias. `${bookId}` stays a
     real reference because that correlation is the point. */
  return sql<number>`coalesce((
    select greatest(wa.copies - coalesce((
      select sum(${chargedQuantitySql()})
      from waitlist_entries we
      where we.invite_allocation_id = wa.id
        and (we.invite_used_at is not null or we.invite_expires_at > now())
    ), 0), 0)
    from waitlist_allocations wa
    where wa.book_id = ${bookId} and wa.status = 'OPEN'
  ), 0)::int`;
}

/**
 * What a member of the public may buy: the print run, less what is owed and
 * less what is set aside.
 *
 * Three terms, and each answers a different question about the same copy —
 * is somebody already holding it, is it being kept for the queue, and does it
 * exist at all.
 *
 * Floored at zero so an over-issued book — more invites out than copies in,
 * which an admin lowering the stock count can create at any time — reads as
 * "sold out" rather than as a negative allowance that some later `>=` accepts
 * by accident. The over-issue itself is a real problem, but it is the
 * waitlist's to report and an admin's to resolve; the storefront's only
 * correct behaviour is to sell nobody anything. The ringfence reaches zero the
 * same way and for a gentler reason: a shop that gives the queue its whole
 * print run has said the public gets none of it, and that is not an error.
 */
export function publicAvailableSql(stock: PgColumn | SQL, bookId: PgColumn | SQL): SQL<number> {
  return sql<number>`greatest(${stock} - ${reservedQuantitySql(bookId)} - ${ringfencedQuantitySql(
    bookId,
  )}, 0)`;
}
