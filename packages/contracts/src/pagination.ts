import { z } from "zod";

/* --------------------------------------------------------------------------
   Offset pagination.

   Not cursor-based: the catalog UI draws numbered pages and needs a total to
   draw them from, and the catalog is measured in dozens of titles. Cursors buy
   stability under insertion at a scale this shop will not reach.
   -------------------------------------------------------------------------- */

/**
 * Hard ceiling on `pageSize`, regardless of what a caller asks for.
 *
 * A cap rather than an error: a client asking for 5000 rows gets 100, not a
 * 400. The point is to bound the work the server will do for one request, and
 * an unbounded page size is the cheapest denial-of-service in any list API.
 */
export const MAX_PAGE_SIZE = 100;

/**
 * `coerce` because these arrive as query strings. Note this is where §3.6's
 * "the validation pipe owns 400" starts: `?page=banana` is a malformed
 * request and fails here, unlike the frontend's current `parseSearchParams`,
 * which silently falls back to page 1.
 *
 * That difference is deliberate but worth knowing — a hand-edited URL that
 * used to degrade to the default view now returns VALIDATION_FAILED. Keep the
 * lenient parse on the web side for URL reading, and let the strict one guard
 * the API.
 */
export function pageQuerySchema(options: { defaultPageSize?: number } = {}) {
  const { defaultPageSize = 24 } = options;

  return z.object({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(defaultPageSize),
  });
}

export type PageQuery = z.infer<ReturnType<typeof pageQuerySchema>>;

/**
 * The list envelope: `{ items, total, page, totalPages }`.
 *
 * `total` is the count *before* pagination — what the "23 books" line reports
 * and what the page control needs. Success responses are otherwise the bare
 * resource (§3.6); this is a wrapper because a list genuinely has metadata,
 * not a general-purpose response envelope.
 */
export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    totalPages: z.number().int().nonnegative(),
  });
}

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  totalPages: number;
};
