import type { BookAvailability } from "@sakura/contracts";

/**
 * The catalog columns that pricing and checkout are allowed to see.
 *
 * Deliberately not `InferSelectModel<typeof books>`. A cart quote needs six
 * fields; handing it the whole row would let a pricing bug depend on
 * `metaDescription` or `unitsSold`, and would make every catalog column a
 * thing checkout's snapshot code has to be re-read against. This is the
 * contract between the two modules, and it is narrow on purpose.
 *
 * `isActive` and `stockQuantity` travel even though neither is a price,
 * because the two callers that ask for a price both have to decide whether the
 * line is orderable, and a second round-trip to answer that would be a second
 * snapshot — i.e. a window in which the two disagree.
 */
export type PriceableBook = {
  id: string;
  slug: string;
  title: string;
  /** Ordered by `book_authors.sort_order`. Empty for a book with no author row. */
  authors: string[];
  coverImageUrl: string;
  priceCents: number;
  stockQuantity: number;
  /**
   * Copies already promised to live waitlist invites for this title.
   *
   * Travels beside `stockQuantity` rather than being fetched separately for
   * the reason the two fields above are here at all: the caller has to decide
   * whether a line is orderable, and orderable means `stockQuantity` less this
   * — a second round trip for the second half of one decision is a window in
   * which the two halves disagree. See `inventory/reservations.ts`.
   */
  reservedQuantity: number;
  isActive: boolean;
  availability: BookAvailability;
  /** Source for `pre_order` lines' "ships around" note. */
  publishedDate: Date | null;
};

/**
 * The published-review rollup for one book, computed at read time.
 *
 * `average` is nullable and `count` is not: a book with no reviews has a count
 * of zero and no average, and representing that as `average: 0` would put a
 * zero-star book on the shelf. See the bookReviews table for why this is not a
 * denormalised column.
 */
export type RatingAggregate = {
  average: number | null;
  count: number;
};

/**
 * The relational-query row shapes the mapper consumes.
 *
 * Written as the shape the query asks for rather than derived from
 * `InferSelectModel`, because the queries select explicit column sets and a
 * derived type would claim columns that are not there. If the query and this
 * type drift, the service stops compiling, which is the intent.
 */
export type BookSummaryRow = {
  id: string;
  slug: string;
  title: string;
  priceCents: number;
  compareAtPriceCents: number | null;
  coverImageUrl: string;
  coverImageAlt: string | null;
  isFeatured: boolean;
  stockQuantity: number;
  /**
   * Copies an ordinary shopper may buy: `stockQuantity` less the copies held
   * by live waitlist invites, floored at zero.
   *
   * This, not `stockQuantity`, is what the public `stockQuantity` field is
   * built from — see `toBookSummary`. Both are on the row because the mapper
   * should be the thing that decides which one the world sees, rather than the
   * query quietly substituting one for the other.
   */
  availableQuantity: number;
  availability: BookAvailability;
  authors: { sortOrder: number; author: { name: string } }[];
};

export type BookDetailRow = BookSummaryRow & {
  subtitle: string | null;
  description: string;
  isbn13: string | null;
  pageCount: number | null;
  language: string;
  publishedDate: Date | null;
  galleryImageUrls: string[] | null;
  pdfUrl: string | null;
  publisher: { slug: string; name: string } | null;
  categories: { category: { slug: string; name: string; group: string | null } }[];
};
