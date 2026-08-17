import { catalog, genres, type CatalogBook, type GenreValue } from "./books";

/* --------------------------------------------------------------------------
   Catalog query — search, genre facets, sort and pagination.

   All of it runs over the placeholder array in ./books.ts, and all of it is
   driven by the URL, so the page stays a server component and a filtered view
   is shareable. Everything here is pure: when apps/api lands, `queryCatalog`
   is the one function that changes.
   -------------------------------------------------------------------------- */

/** Cards per page. Nine placeholder titles at 6 a page gives two pages, which
    is enough to exercise the pagination the wireframe draws. Raise to 9+ once
    the catalogue is real and the control should disappear on a single page. */
export const PAGE_SIZE = 6;

export const sortOptions = [
  { value: "recent", label: "Recently added" },
  { value: "title", label: "Title A–Z" },
  { value: "price-asc", label: "Price, low to high" },
  { value: "rating", label: "Best rated" },
] as const;

export type SortValue = (typeof sortOptions)[number]["value"];

const defaultSort: SortValue = "recent";

export type CatalogQuery = {
  q: string;
  genres: GenreValue[];
  sort: SortValue;
  page: number;
};

/** What Next hands a page as `searchParams`. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

const genreValues = new Set<string>(genres.map((genre) => genre.value));
const sortValues = new Set<string>(sortOptions.map((option) => option.value));

/**
 * Reads the URL into a query. Unknown genres, unknown sorts and junk page
 * numbers are dropped rather than errored — a hand-edited URL should degrade
 * to the default view, not a crash.
 */
export function parseSearchParams(params: RawSearchParams): CatalogQuery {
  const rawSort = first(params.sort);
  const page = Number.parseInt(first(params.page), 10);

  return {
    q: first(params.q),
    genres: first(params.genre)
      .split(",")
      .map((value) => value.trim())
      .filter((value): value is GenreValue => genreValues.has(value)),
    sort: sortValues.has(rawSort) ? (rawSort as SortValue) : defaultSort,
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/** Serialises a query back to a query string, omitting anything at default so
    the plain `/catalog` URL stays clean. */
export function toSearchParams(query: Partial<CatalogQuery>): string {
  const params = new URLSearchParams();

  if (query.q) params.set("q", query.q);
  if (query.genres?.length) params.set("genre", query.genres.join(","));
  if (query.sort && query.sort !== defaultSort) params.set("sort", query.sort);
  if (query.page && query.page > 1) params.set("page", String(query.page));

  const search = params.toString();
  return search ? `?${search}` : "";
}

function matches(book: CatalogBook, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    book.title.toLowerCase().includes(needle) || book.author.toLowerCase().includes(needle)
  );
}

const comparators: Record<SortValue, (a: CatalogBook, b: CatalogBook) => number> = {
  /* "Recently added" is the order the shelf is written in — no date field yet. */
  recent: () => 0,
  title: (a, b) => a.title.localeCompare(b.title),
  /* Integer minor units, so this is an ordinary numeric compare. It used to
     have to parse the digits back out of a "£14.00" display string, which is
     the clearest evidence the string was the wrong shape to hold a price. */
  "price-asc": (a, b) => a.priceCents - b.priceCents,
  rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
};

export type CatalogResult = {
  books: CatalogBook[];
  /** Matches before pagination — what the count line reports. */
  total: number;
  page: number;
  totalPages: number;
};

export function queryCatalog(query: CatalogQuery): CatalogResult {
  const filtered = catalog
    .filter((book) => matches(book, query.q))
    .filter((book) => query.genres.length === 0 || query.genres.includes(book.genre));

  const sorted = [...filtered].sort(comparators[query.sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  /* A filter that shrinks the results can strand the page number past the end;
     clamp rather than showing an empty page that looks like no matches. */
  const page = Math.min(query.page, totalPages);
  const start = (page - 1) * PAGE_SIZE;

  return {
    books: sorted.slice(start, start + PAGE_SIZE),
    total: sorted.length,
    page,
    totalPages,
  };
}
