"use client";

import { useQuery } from "@tanstack/react-query";

import { listBooks } from "@/lib/api/catalog";

/* --------------------------------------------------------------------------
   How many titles are actually on the shelf.

   This replaces a hardcoded `titlesInStock = 41` in lib/books.ts, which was
   left behind when the catalog moved to GET /books. It was a number nobody
   maintained, quoted as fact to a customer standing in front of an empty
   cart — and the placeholder array it sat next to never held 41 books either,
   so `catalog.length` would have been no more honest.

   The count comes from the same `total` the landing page reads off the list.
   `pageSize: 1` is deliberate: the only field wanted is the count, and asking
   for a page of books to throw them away would pull covers over the wire for
   a single line of copy.
   -------------------------------------------------------------------------- */

/** Freshness of the count. Mirrors CATALOG_REVALIDATE in lib/api/catalog.ts. */
const COUNT_STALE_MS = 60_000;

/**
 * The shelf's size, or `null` while it is unknown.
 *
 * Null rather than a guess, in both the loading and the failed case: the
 * caller is writing a sentence about how many books are waiting, and there is
 * copy for not knowing. A fallback number here would put an invented figure
 * in that sentence, which is the bug this hook exists to remove.
 */
export function useTitlesInStock(): number | null {
  const { data } = useQuery({
    queryKey: ["catalog", "count"],
    queryFn: () => listBooks({ q: "", genres: [], sort: "recent", page: 1 }, { pageSize: 1 }),
    staleTime: COUNT_STALE_MS,
  });

  return data?.total ?? null;
}
