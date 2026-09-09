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
    /* What the public may buy, not what is on the shelf.
       The storefront reads this field to draw "sold out", "last copy" and the
       schema.org availability tag, and to decide whether to offer a Buy
       button at all. Handing it the raw count would advertise as purchasable
       the sixty copies that are already promised to sixty people on the
       waitlist — the shopper would click through, fill in the form, and be
       refused by the guarded decrement, which is the worst place to find out.
       What a shopper means by "in stock" is "can I have one", and for a title
       whose copies are all spoken for the answer is no. The true shelf count
       is still exactly one query away for anyone who needs it, on the admin
       contract, which keeps its own field.
       Clamped as well, though `publicAvailableSql` already floors at zero and
       the check constraint now refuses a negative stock outright. It stays
       because of what this particular field failing looks like:
       `bookSummarySchema` declares it nonnegative, so a single bad row fails
       the whole list parse in the web app — which is how one title at -1 took
       down the catalog, the homepage and every book page at once. A corrupt
       row should cost a wrong badge on one card, not the storefront. */
    stockQuantity: Math.max(0, row.availableQuantity),
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
