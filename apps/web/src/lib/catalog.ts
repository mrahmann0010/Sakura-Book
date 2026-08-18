import { bookSortValues, CATALOG_PAGE_SIZE, type BookSort } from "@sakura/contracts";

/* --------------------------------------------------------------------------
   Catalog query — the URL half.

   What used to be here as well was `queryCatalog`, which filtered, sorted and
   paginated the hardcoded array in ./books.ts. That is now the API's job; see
   lib/api/catalog.ts. What remains is the part that was always the frontend's:
   reading the address bar into a query, and writing one back.

   Filters live in the URL rather than in state, so the catalog page stays a
   server component and every filtered view is a link someone can send.
   -------------------------------------------------------------------------- */

/** Cards per page. Not a second opinion — the API decides, this re-exports it. */
export const PAGE_SIZE = CATALOG_PAGE_SIZE;

/**
 * Sort values come from the contract, so a value the API does not accept
 * cannot be offered. Labels stay here because they are translated at render
 * from `catalog.sort.<value>` — the server has no business shipping copy in
 * one language to a trilingual app.
 */
export const sortOptions = bookSortValues.map((value) => ({ value }));

export type SortValue = BookSort;

const defaultSort: SortValue = "recent";

const sortValues = new Set<string>(bookSortValues);

export type CatalogQuery = {
  q: string;
  /**
   * Category slugs. Open, not a closed union: the `categories` table owns the
   * vocabulary and the rail is fetched from it, so baking today's values into
   * a type here would mean a code change to add a category. A slug that no
   * longer exists matches nothing, which is the same empty shelf a real
   * category with no books gives — and is why this does not need validating.
   */
  genres: string[];
  sort: SortValue;
  page: number;
};

/** What Next hands a page as `searchParams`. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/**
 * Reads the URL into a query. Unknown sorts and junk page numbers are dropped
 * rather than errored — a hand-edited URL should degrade to the default view,
 * not a crash.
 *
 * This is the lenient parse the contract's pagination comment refers to. The
 * API's own parse is strict and returns VALIDATION_FAILED for `?page=banana`;
 * the difference is deliberate, and it only holds as long as this function
 * never forwards its input verbatim. `listBooks` translates field by field for
 * that reason.
 */
export function parseSearchParams(params: RawSearchParams): CatalogQuery {
  const rawSort = first(params.sort);
  const page = Number.parseInt(first(params.page), 10);

  return {
    q: first(params.q),
    genres: first(params.genre)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    sort: sortValues.has(rawSort) ? (rawSort as SortValue) : defaultSort,
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/** Serialises a query back to a query string, omitting anything at default so
    the plain `/catalog` URL stays clean. */
export function toSearchParams(query: Partial<CatalogQuery>): string {
  const params = new URLSearchParams();

  if (query.q) params.set("q", query.q);
  /* Comma-joined in the address bar because that is what a person reads and
     copies. The wire format is repeated `genre=` params, and lib/api/client.ts
     owns that translation — the two do not have to agree and should not be
     coupled. */
  if (query.genres?.length) params.set("genre", query.genres.join(","));
  if (query.sort && query.sort !== defaultSort) params.set("sort", query.sort);
  if (query.page && query.page > 1) params.set("page", String(query.page));

  const search = params.toString();
  return search ? `?${search}` : "";
}
