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
  isActive: boolean;
};
