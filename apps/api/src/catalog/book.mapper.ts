import type { BookDetail, BookSummary } from "@sakura/contracts";
import type { BookDetailRow, BookSummaryRow, RatingAggregate } from "./book.types";

/**
 * Database rows → the shapes in @sakura/contracts.
 *
 * The mapping is explicit rather than a spread, and that is the point: a
 * column added to `books` must not reach the wire because someone forgot this
 * file exists. `metaTitle`, `sku`, `lowStockThreshold` and `unitsSold` are all
 * on the row and none of them are the customer's business.
 */

/** Credited order comes from `book_authors.sort_order`, not insertion order. */
function authorNames(links: { sortOrder: number; author: { name: string } }[]): string[] {
  return [...links].sort((a, b) => a.sortOrder - b.sortOrder).map((link) => link.author.name);
}

/**
 * Ratings are null until reviews exist.
 *
 * `count === 0` returns null rather than 0, because the card renders "no
 * reviews yet" off the null and would render a literal zero-star average off
 * the other. There is no review data yet by design — see the bookReviews
 * table comment — so this is the normal path today, not an edge case.
 */
function rating(
  aggregate: RatingAggregate | undefined,
): Pick<BookSummary, "rating" | "ratingCount"> {
  if (!aggregate || aggregate.count === 0) return { rating: null, ratingCount: null };

  return { rating: aggregate.average, ratingCount: aggregate.count };
}

export function toBookSummary(row: BookSummaryRow, aggregate?: RatingAggregate): BookSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    authors: authorNames(row.authors),

    priceCents: row.priceCents,
    compareAtPriceCents: row.compareAtPriceCents,

    coverImageUrl: row.coverImageUrl,
    coverImageAlt: row.coverImageAlt,

    isFeatured: row.isFeatured,
    stockQuantity: row.stockQuantity,
    availability: row.availability,

    ...rating(aggregate),
  };
}

export function toBookDetail(row: BookDetailRow, aggregate?: RatingAggregate): BookDetail {
  return {
    ...toBookSummary(row, aggregate),

    subtitle: row.subtitle,
    description: row.description,
    isbn13: row.isbn13,
    pageCount: row.pageCount,
    language: row.language,
    // ISO date strings, not Date objects: the contract says string, and the
    // three locales format this client-side from an unambiguous instant.
    publishedDate: row.publishedDate?.toISOString() ?? null,
    publisher: row.publisher ? { slug: row.publisher.slug, name: row.publisher.name } : null,
    categories: row.categories.map((link) => ({
      slug: link.category.slug,
      name: link.category.name,
      group: link.category.group,
    })),
    // The column is nullable jsonb; the contract is an array. An absent gallery
    // is an empty one to every client, and normalising it here means no
    // component has to write `?? []`.
    galleryImageUrls: row.galleryImageUrls ?? [],
    /* The sample chapters, or null when the shop has not uploaded any. The
       sibling `pdfFileName` stays admin-only: the reader is titled with the
       book, and the stored filename is whatever the shop happened to call the
       file on its own disk. */
    pdfUrl: row.pdfUrl,
  };
}
