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
 * Order matters. CANCELLED and CONVERTED come first because they are terminal:
 * a cancelled entry whose token has not yet been revoked is still cancelled,
 * and a converted one keeps the spent token it was converted with. EXPIRED
 * precedes INVITED so the latter needs no expiry clause of its own — anything
 * reaching it has already failed the `<= now()` test above.
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
       and ${waitlistEntries.inviteExpiresAt} <= now() then 'EXPIRED'
      when ${waitlistEntries.inviteToken} is not null
       and ${waitlistEntries.inviteUsedAt} is null then 'INVITED'
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
