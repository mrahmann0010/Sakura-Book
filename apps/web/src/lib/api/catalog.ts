import {
  authorDetailSchema,
  bookDetailSchema,
  bookListSchema,
  categoryGroupSchema,
  type AuthorDetail,
  type BookDetail,
  type BookList,
  type CategoryGroup,
} from "@sakura/contracts";
import { z } from "zod";

import type { CatalogQuery } from "@/lib/catalog";

import { apiFetch } from "./client";

/* --------------------------------------------------------------------------
   Catalog reads.

   The `revalidate` numbers mirror apps/api/src/catalog/catalog.cache.ts: 60s
   for the shelf, 300s for the reference data. Next's data cache sits in front
   of the API's Cache-Control rather than replacing it, so leaving these off
   would let a server-rendered page hold a sold-out book for longer than the
   API ever asked anyone to.
   -------------------------------------------------------------------------- */

/** Freshness of the shelf itself. Price and stock ride on these responses. */
const CATALOG_REVALIDATE = 60;

/** The filter rail changes when staff change it. */
const REFERENCE_REVALIDATE = 300;

/**
 * Browse.
 *
 * Takes the app's own `CatalogQuery` — the lenient URL parse — and translates
 * it at the boundary. The two shapes are close enough to tempt a spread, and
 * they must not be one: the URL parse is deliberately forgiving so a
 * hand-edited link degrades instead of erroring, while the API's parse is
 * strict, and a spread would forward the forgiving shape's junk straight into
 * a VALIDATION_FAILED.
 */
export function listBooks(query: CatalogQuery): Promise<BookList> {
  return apiFetch("/books", bookListSchema, {
    query: {
      q: query.q,
      genre: query.genres,
      sort: query.sort,
      page: query.page,
    },
    revalidate: CATALOG_REVALIDATE,
  });
}

/** One title, by the slug in the URL. Throws ApiError with `isNotFound` for a miss. */
export function getBook(slug: string): Promise<BookDetail> {
  return apiFetch(`/books/${encodeURIComponent(slug)}`, bookDetailSchema, {
    revalidate: CATALOG_REVALIDATE,
  });
}

/** The filter rail's vocabulary, pre-grouped by the API. */
export function getCategories(): Promise<CategoryGroup[]> {
  return apiFetch("/categories", z.array(categoryGroupSchema), {
    revalidate: REFERENCE_REVALIDATE,
  });
}

export function getAuthor(slug: string): Promise<AuthorDetail> {
  return apiFetch(`/authors/${encodeURIComponent(slug)}`, authorDetailSchema, {
    revalidate: REFERENCE_REVALIDATE,
  });
}
