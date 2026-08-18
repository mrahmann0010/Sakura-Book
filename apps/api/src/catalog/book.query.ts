import { and, asc, desc, eq, exists, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import type { BookQuery } from "@sakura/contracts";
import { authors, bookAuthors, bookCategories, books, bookReviews, categories } from "../db/schema";

/**
 * The `where` and `order by` for a catalog browse, built from validated query
 * params.
 *
 * Split out of the service because these are the two pieces worth reading on
 * their own and worth unit-testing without a database: everything else in
 * `list()` is pagination arithmetic and mapping. Every function here returns a
 * fragment, never runs a query.
 */

/**
 * Average published rating for a book, as a scalar subquery.
 *
 * A correlated subquery rather than a LEFT JOIN + GROUP BY because it has to be
 * usable in ORDER BY without changing the grouping of the outer query, and
 * because a join against a one-to-many multiplies the rows the paginator is
 * counting. There is no denormalised rating column by decision — see the
 * comment on the bookReviews table.
 */
export function ratingAverage(): SQL<number | null> {
  return sql<number | null>`(
    select round(avg(${bookReviews.rating})::numeric, 2)
    from ${bookReviews}
    where ${bookReviews.bookId} = ${books.id} and ${bookReviews.isPublished}
  )`;
}

export function ratingCount(): SQL<number> {
  return sql<number>`(
    select count(*)::int
    from ${bookReviews}
    where ${bookReviews.bookId} = ${books.id} and ${bookReviews.isPublished}
  )`;
}

/**
 * Free-text match over title and author name.
 *
 * `ILIKE '%term%'` against the trigram indexes on `books.title` and
 * `authors.name`. The author half is an EXISTS rather than a join for the same
 * reason as the rating: a book with three authors must not appear three times
 * in a paginated list, and EXISTS stops at the first match instead of
 * materialising all of them.
 *
 * The term is escaped, not interpolated raw: an unescaped `%` typed into the
 * search box would otherwise match everything, and `_` would match any
 * character — a search for "vol_1" quietly returning the whole shelf is the
 * kind of bug nobody reports.
 */
function textMatch(term: string): SQL {
  const pattern = `%${term.replace(/([\\%_])/g, "\\$1")}%`;

  return or(
    ilike(books.title, pattern),
    /* The parentheses are written out rather than left to `exists()`. Drizzle
       parenthesises a query *builder* it is handed, but a raw `sql` fragment
       is emitted verbatim — so this rendered as `exists select 1 from ...`,
       which Postgres rejects outright. Every search was a 500. */
    exists(
      sql`(select 1 from ${bookAuthors}
          join ${authors} on ${authors.id} = ${bookAuthors.authorId}
          where ${bookAuthors.bookId} = ${books.id} and ${authors.name} ilike ${pattern})`,
    ),
  )!;
}

/** A book carries a given category slug. Used for both `category` and `genre`. */
function inCategories(slugs: string[]): SQL {
  /* Parenthesised for the same reason as `textMatch` above — see the comment
     there. Without it every category filter was a 500. */
  return exists(
    sql`(select 1 from ${bookCategories}
        join ${categories} on ${categories.id} = ${bookCategories.categoryId}
        where ${bookCategories.bookId} = ${books.id}
          and ${inArray(categories.slug, slugs)})`,
  );
}

/**
 * Every filter, ANDed.
 *
 * `isActive` is not a filter the caller can turn off. A delisted book is not
 * part of the shelf, and the browse endpoint is public — the admin surface,
 * when it exists, gets its own query rather than a flag on this one, because a
 * flag on this one is how an inactive title ends up on the storefront.
 *
 * `genre` and `category` are separate params that mean the same thing to the
 * database: the web app draws genres as a facet row and category as a rail,
 * but both are `categories.slug`. They intersect rather than union — picking
 * a genre and a category means "both", which is what a filter UI implies.
 */
export function bookFilters(query: BookQuery): SQL {
  const conditions: SQL[] = [eq(books.isActive, true)];

  if (query.q) conditions.push(textMatch(query.q));
  if (query.category) conditions.push(inCategories([query.category]));
  if (query.genre?.length) conditions.push(inCategories(query.genre));

  return and(...conditions)!;
}

/**
 * Sort, with a stable tiebreak.
 *
 * Every branch ends in `books.id` because offset pagination over a
 * non-deterministic order silently drops and duplicates rows across pages:
 * two books with the same price have no defined relative order, so page 2 may
 * repeat what page 1 showed. The tiebreak is invisible and load-bearing.
 *
 * `rating` sorts nulls last, which is not a formatting nicety — with no
 * reviews in the database yet, every book's average is null, so ascending
 * nulls would make the "top rated" sort return the shelf in an arbitrary
 * order and look broken.
 */
export function bookOrder(sort: BookQuery["sort"]): SQL[] {
  switch (sort) {
    case "title":
      return [asc(books.title), asc(books.id)];
    case "price-asc":
      return [asc(books.priceCents), asc(books.id)];
    case "rating":
      return [sql`${ratingAverage()} desc nulls last`, asc(books.id)];
    case "recent":
    default:
      return [desc(books.createdAt), asc(books.id)];
  }
}

/** Preserve the SQL ordering through a second, unordered fetch by id. */
export function orderByIds<T extends { id: string }>(rows: T[], ids: string[]): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));

  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
}
