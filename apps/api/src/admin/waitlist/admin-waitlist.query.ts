import type { AdminWaitlistQuery } from "@sakura/contracts";
import { and, asc, desc, gte, ilike, inArray, lte, or, type SQL } from "drizzle-orm";
import { waitlistEntries } from "../../db/schema";

/**
 * `where` and `order by` for the waitlist, built from validated params.
 *
 * Split from the service for the same reason admin-order.query.ts is: every
 * function returns a fragment and runs nothing, which is what makes the
 * filters readable on their own.
 *
 * Unlike the order queue this takes a `skipStatus` flag, because the status
 * counts are the same query with that one condition dropped. Building them
 * from one function rather than two is what keeps the tabs honest — a filter
 * added here cannot apply to the rows and not to the numbers above them.
 */

/**
 * Free text across the three identifiers staff have to hand.
 *
 * No anchored branch here, unlike the order queue's order number: a waitlist
 * entry has no short printed identifier anybody quotes. All three are
 * substring matches, since the caller may offer half a name or the last
 * digits of a phone.
 *
 * Escaped before interpolation — an unescaped `%` typed into the search box
 * matches every entry in the table, which reads as a broken filter rather
 * than as the wildcard it is.
 */
function textMatch(term: string): SQL {
  const escaped = term.replace(/([\\%_])/g, "\\$1");

  return or(
    ilike(waitlistEntries.customerName, `%${escaped}%`),
    ilike(waitlistEntries.customerEmail, `%${escaped}%`),
    ilike(waitlistEntries.customerPhone, `%${escaped}%`),
  )!;
}

export function adminWaitlistFilters(
  query: AdminWaitlistQuery,
  options: { skipStatus?: boolean } = {},
): SQL | undefined {
  const conditions: SQL[] = [];

  if (!options.skipStatus && query.status?.length) {
    conditions.push(inArray(waitlistEntries.status, query.status));
  }

  if (query.q) conditions.push(textMatch(query.q));
  if (query.source) conditions.push(ilike(waitlistEntries.source, query.source));
  if (query.locale) conditions.push(ilike(waitlistEntries.locale, query.locale));

  if (query.signedFrom) {
    conditions.push(gte(waitlistEntries.createdAt, new Date(`${query.signedFrom}T00:00:00.000Z`)));
  }

  /* The end of the named day, not its midnight — same reasoning as the order
     queue's `placedTo`, and the same silent failure if it were otherwise:
     everyone who signed up on the last day of the range would vanish from it. */
  if (query.signedTo) {
    conditions.push(lte(waitlistEntries.createdAt, new Date(`${query.signedTo}T23:59:59.999Z`)));
  }

  return conditions.length ? and(...conditions) : undefined;
}

/**
 * Sort, with a stable tiebreak on every branch.
 *
 * Offset pagination over a non-deterministic order drops and duplicates rows
 * between pages, and here that means a person who silently never appears on
 * any page of the list you are working through — which is the exact promise
 * the signup form made to them.
 */
export function adminWaitlistOrder(sort: AdminWaitlistQuery["sort"]): SQL[] {
  switch (sort) {
    case "recent":
      return [desc(waitlistEntries.createdAt), asc(waitlistEntries.id)];
    case "quantity-desc":
      return [desc(waitlistEntries.quantity), asc(waitlistEntries.createdAt), asc(waitlistEntries.id)];
    case "oldest":
    default:
      return [asc(waitlistEntries.createdAt), asc(waitlistEntries.id)];
  }
}
