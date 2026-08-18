import { z } from "zod";
import { paginated, pageQuerySchema } from "./pagination";

/* --------------------------------------------------------------------------
   Catalog reads. Replaces queryCatalog() in apps/web/src/lib/catalog.ts.
   -------------------------------------------------------------------------- */

/** Cards per page. Nine placeholder titles at 6 gives two pages, which is what
    exercises the pagination control the wireframe draws. Raise once the
    catalog is real. Mirrors PAGE_SIZE in the web app. */
export const CATALOG_PAGE_SIZE = 6;

export const bookSortValues = ["recent", "title", "price-asc", "rating"] as const;
export type BookSort = (typeof bookSortValues)[number];

export const bookQuerySchema = pageQuerySchema({ defaultPageSize: CATALOG_PAGE_SIZE }).extend({
  /** Free text over title and author name — pg_trgm, per §3.16. */
  q: z.string().trim().max(120).optional(),

  /**
   * Slugs, not a closed enum. The `genres` list in the web app is a
   * placeholder facet over a hardcoded array; once the catalog is real the
   * `categories` table owns the vocabulary, and baking today's five values
   * into a shared contract would need a package release to add a sixth.
   * Unknown slugs match nothing rather than erroring.
   */
  genre: z
    .preprocess(
      /* `?genre=fiction` and `?genre=fiction&genre=poetry` are the same
         intent, but qs — which is what Express hands Nest — parses the first
         as a string and the second as an array. Without this, filtering on
         exactly one genre is a 400, which is both the most common case and the
         one a hand-written test with two values never catches. Normalising
         here rather than in the controller keeps the web app's serialiser free
         to emit whichever form is tidier. */
      (value) => (typeof value === "string" ? [value] : value),
      z.array(z.string().trim().min(1)),
    )
    .optional(),
  category: z.string().trim().min(1).optional(),

  sort: z.enum(bookSortValues).default("recent"),
});

export type BookQuery = z.infer<typeof bookQuerySchema>;

/**
 * What a book card needs, and nothing more.
 *
 * Note what is absent: `flag`. The web app's BookSummary carries
 * `"editors-pick" | "last-copy"`, which are presentation decisions derived
 * from facts — featured status and remaining stock. The API returns the facts;
 * `components/domain/types.ts` becomes a view model that derives the badge.
 * Otherwise the server ends up owning copy, in one language, for a trilingual
 * frontend.
 */
export const bookSummarySchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  /** Display names in credited order. Denormalised for the card. */
  authors: z.array(z.string()),

  /** Minor units, never a formatted string (§3.7). */
  priceCents: z.number().int().nonnegative(),
  /** Struck-through "was" price, when the book is discounted. */
  compareAtPriceCents: z.number().int().nonnegative().nullable(),

  coverImageUrl: z.string(),
  coverImageAlt: z.string().nullable(),

  isFeatured: z.boolean(),
  /** Remaining stock, so the client can draw "last copy" and clamp steppers. */
  stockQuantity: z.number().int().nonnegative(),

  /**
   * OPEN DECISION (§7.2): there is no reviews or ratings table. Nullable here
   * so the contract is honest about that — the card already renders a rating,
   * so the choice is to add the table or strip the field from both sides.
   * Nullable is the shape either way; it just becomes permanently null if the
   * feature is dropped.
   */
  rating: z.number().min(0).max(5).nullable(),
  ratingCount: z.number().int().nonnegative().nullable(),
});

export const bookDetailSchema = bookSummarySchema.extend({
  subtitle: z.string().nullable(),
  description: z.string(),
  isbn13: z.string().nullable(),
  pageCount: z.number().int().positive().nullable(),
  language: z.string(),
  publishedDate: z.string().nullable(),
  publisher: z.object({ slug: z.string(), name: z.string() }).nullable(),
  categories: z.array(
    z.object({ slug: z.string(), name: z.string(), group: z.string().nullable() }),
  ),
  galleryImageUrls: z.array(z.string()),
});

export const bookListSchema = paginated(bookSummarySchema);

export type BookSummary = z.infer<typeof bookSummarySchema>;
export type BookDetail = z.infer<typeof bookDetailSchema>;
export type BookList = z.infer<typeof bookListSchema>;

/**
 * An author, with the books credited to them.
 *
 * Shares `bookSummarySchema` with the browse list rather than defining a
 * slimmer card, so the author page can render the same component the catalog
 * grid does. Books are the point of the page; the bio is optional garnish and
 * is nullable because most rows will not have one.
 */
export const authorDetailSchema = z.object({
  slug: z.string(),
  name: z.string(),
  bio: z.string().nullable(),
  photoUrl: z.string().nullable(),
  books: z.array(bookSummarySchema),
});

export type AuthorDetail = z.infer<typeof authorDetailSchema>;

/** Grouped for the filter rail, matching `categories.group` in the schema. */
export const categoryGroupSchema = z.object({
  group: z.string().nullable(),
  categories: z.array(z.object({ slug: z.string(), name: z.string() })),
});

export type CategoryGroup = z.infer<typeof categoryGroupSchema>;
