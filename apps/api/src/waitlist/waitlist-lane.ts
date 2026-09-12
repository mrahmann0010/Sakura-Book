import { sql, type SQL } from "drizzle-orm";
import type { WaitlistLane } from "@sakura/contracts";
import { waitlistEntries } from "../db/schema";

/* --------------------------------------------------------------------------
   Where a waitlist entry stands right now, defined once.

   `status` is what people decided — we reached them, they bought, they asked
   to come off the list. It moves only when somebody writes it, and it has no
   opinion about the clock. That is the right shape for a decision log and the
   wrong shape for the question staff actually work from on a restock morning:
   is this person holding a copy, did their window lapse, or have they not had
   a turn yet.

   That question's answer changes with no write at all — an invite lapses
   because time passed — so it is computed, never stored. There is deliberately
   no EXPIRED member of `waitlist_status`: storing it would mean writing it,
   and between a window closing and whatever job noticed, the database would
   say a copy is held while the shelf says it is free. That gap is where a shop
   oversells.

   The INVITED branch below is character-for-character the condition
   `inventory/reservations.ts` holds a copy back under, and that is the whole
   point rather than a coincidence:

     a copy is off the public shelf  <=>  its entry is in the INVITED lane

   Two hand-written copies of that condition is how the admin panel and the
   storefront start disagreeing about who is holding what, so there is one.
   -------------------------------------------------------------------------- */

/**
 * The lane, as a SQL expression, for use in a selection, a WHERE or a GROUP BY.
 *
 * Evaluated by Postgres against `now()` rather than in Node against a JS
 * `Date`. A list and the counts above it are two statements; asking two
 * different clocks — or the same clock twice, either side of an invite
 * lapsing — is how a tab ends up showing a number it has no rows for.
 *
 * Order matters, and each position answers a "which of these two facts about
 * the same row wins" question that has a real answer.
 *
 * CANCELLED and CONVERTED come first because they are terminal: a cancelled
 * entry whose token has not yet been revoked is still cancelled, and a
 * converted one keeps the spent token it was converted with.
 *
 * INVITED comes before ORDERED, and pays for it with an expiry clause it used
 * not to need. An entry can hold a live link *and* an unpaid order — staff can
 * invite someone the wave planner skipped — and when it does, the storefront
 * is holding copies for that link. The INVITED branch is the one condition
 * `inventory/reservations.ts` keeps a copy off the shelf under, so a row
 * matching it must land here or the panel and the shelf start describing the
 * same copy differently, which is the one thing this module exists to prevent.
 *
 * ORDERED then comes before EXPIRED, which is the opposite trade and the right
 * one: a lapsed invite holds nothing, so nothing is misreported by letting the
 * order speak instead — and letting EXPIRED win would put somebody with a
 * parcel already on the way back into the next wave's candidate pool, which is
 * exactly the mistake the lane was added to stop.
 *
 * Written with column objects rather than the raw `we.`-prefixed identifiers
 * `reservations.ts` is forced into: this is only ever used in plain
 * `db.select()` builders over `waitlist_entries`, never inside a relational
 * query, so there is no outer alias for drizzle to rewrite these into.
 */
export function waitlistLaneSql(): SQL<WaitlistLane> {
  return sql<WaitlistLane>`
    case
      when ${waitlistEntries.status} = 'CANCELLED' then 'CANCELLED'
      when ${waitlistEntries.status} = 'CONVERTED' then 'CONVERTED'
      when ${waitlistEntries.inviteToken} is not null
       and ${waitlistEntries.inviteUsedAt} is null
       and ${waitlistEntries.inviteExpiresAt} > now() then 'INVITED'
      when ${waitlistEntries.fulfillingOrderId} is not null then 'ORDERED'
      when ${waitlistEntries.inviteToken} is not null
       and ${waitlistEntries.inviteUsedAt} is null then 'EXPIRED'
      else 'WAITING'
    end
  `;
}

/**
 * A WHERE fragment matching any of the given lanes.
 *
 * Re-evaluates the CASE rather than comparing against a stored column, which
 * means no index can serve it. That is a deliberate trade at this shop's
 * scale: a waitlist that fits comfortably in a few thousand rows costs
 * nothing to scan, and the alternative — a materialised lane column — buys
 * speed with exactly the staleness this whole module exists to avoid.
 *
 * Empty array returns undefined rather than a clause matching nothing: an
 * empty filter means "no lane filter", the same way the query builder treats
 * every other absent parameter.
 */
export function waitlistLaneFilterSql(lanes: readonly WaitlistLane[]): SQL | undefined {
  if (lanes.length === 0) return undefined;

  return sql`${waitlistLaneSql()} in (${sql.join(
    lanes.map((lane) => sql`${lane}`),
    sql`, `,
  )})`;
}
