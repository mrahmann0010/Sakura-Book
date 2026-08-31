import type { AdminReviewQuery } from "@sakura/contracts";
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { initialReviews } from "../../db/schema";

/**
 * `where` and `order by` for the moderation queue, built from validated
 * params.
 *
 * Split from the service the way admin-waitlist.query.ts is: every function
 * returns a fragment and runs nothing, which is what makes the filters
 * readable on their own. It takes the same `skipStatus` flag, because the
 * status counts are this query with that one condition dropped — building
 * both from one function is what keeps the tabs honest.
 */

/**
 * Free text across what a moderator actually has to hand.
 *
 * The body is included, unlike the waitlist's search: the common case is
 * "find the one that mentioned the courier", and a queue you can only search
 * by name is a queue you scroll.
 *
 * Escaped before interpolation — an unescaped `%` typed into the search box
 * matches every row, which reads as a broken filter rather than as the
 * wildcard it is.
 */
function textMatch(term: string): SQL {
  const escaped = term.replace(/([\\%_])/g, "\\$1");

  return or(
    ilike(initialReviews.authorName, `%${escaped}%`),
    ilike(initialReviews.authorEmail, `%${escaped}%`),
    ilike(initialReviews.title, `%${escaped}%`),
    ilike(initialReviews.body, `%${escaped}%`),
  )!;
}

export function adminReviewFilters(
  query: AdminReviewQuery,
  options: { skipStatus?: boolean } = {},
): SQL | undefined {
  const conditions: SQL[] = [];

  if (!options.skipStatus && query.status?.length) {
    conditions.push(inArray(initialReviews.status, query.status));
  }

  if (query.q) conditions.push(textMatch(query.q));

  if (query.isFeatured !== undefined) {
    conditions.push(eq(initialReviews.isFeatured, query.isFeatured));
  }

  if (query.submittedFrom) {
    conditions.push(gte(initialReviews.createdAt, new Date(`${query.submittedFrom}T00:00:00.000Z`)));
  }

  /* The end of the named day, not its midnight — same reasoning as the order
     queue's `placedTo`, and the same silent failure if it were otherwise:
     everything submitted on the last day of the range would vanish from it. */
  if (query.submittedTo) {
    conditions.push(lte(initialReviews.createdAt, new Date(`${query.submittedTo}T23:59:59.999Z`)));
  }

  return conditions.length ? and(...conditions) : undefined;
}

/**
 * Sort, with a stable tiebreak on every branch.
 *
 * Offset pagination over a non-deterministic order drops and duplicates rows
 * between pages, and here that means a submission that silently never appears
 * on any page of the queue you are working through — i.e. a real person's
 * review that is never moderated because it was never seen.
 *
 * The rating branches put nulls last in both directions: an unrated
 * testimonial is not a zero-star review and should not lead a
 * worst-first list.
 */
export function adminReviewOrder(sort: AdminReviewQuery["sort"]): SQL[] {
  switch (sort) {
    case "oldest":
      return [asc(initialReviews.createdAt), asc(initialReviews.id)];
    case "rating-desc":
      return [
        sql`${initialReviews.rating} desc nulls last`,
        desc(initialReviews.createdAt),
        asc(initialReviews.id),
      ];
    case "rating-asc":
      return [
        sql`${initialReviews.rating} asc nulls last`,
        desc(initialReviews.createdAt),
        asc(initialReviews.id),
      ];
    case "recent":
    default:
      return [desc(initialReviews.createdAt), asc(initialReviews.id)];
  }
}
