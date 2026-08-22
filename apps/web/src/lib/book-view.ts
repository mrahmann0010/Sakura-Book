import type { BookSummary as ApiBook } from "@sakura/contracts";

import type { BookFlag, BookSummary } from "@/components/domain";
import { routes } from "@/lib/routes";

/* --------------------------------------------------------------------------
   The wire shape → the shape the cards read.

   This file exists because @sakura/contracts deliberately does not carry
   `flag`. "Editor's pick" and "Last copy" are copy, in one language, derived
   from two facts the API does send — `isFeatured` and `stockQuantity` — and a
   trilingual frontend cannot let the server own the words. The API states the
   facts; the badge is decided here.

   Everything else in here is the same kind of narrowing: `authors: string[]`
   becomes one credited line, nullable rating becomes optional, and the slug
   becomes a locale-prefixed href. None of it is arithmetic, and none of it
   belongs in a component.
   -------------------------------------------------------------------------- */

/**
 * Stock at or below this draws "Last copy".
 *
 * One, not the inventory table's `low_stock_threshold`. That column is an
 * operational signal for the shop — reorder now — and it is set per title;
 * this is a nudge to a customer looking at a card, and it has to mean the same
 * thing on every card in a grid. They are two different numbers that happen to
 * be small.
 */
const LAST_COPY_AT = 1;

/**
 * At most one badge, and scarcity wins.
 *
 * A featured book down to its last copy is both, and "Last copy" is the one
 * that changes what the reader does next — the pick is an opinion, the stock
 * is a deadline.
 *
 * `availability` decides "coming soon" vs. "pre-order" now, not a bare zero
 * stock count: a `coming_soon` row is never orderable (and always carries
 * zero stock, enforced server-side), while a `pre_order` row is a normal
 * buyable book that happens to ship later — it can run its own stock to zero
 * exactly like an `in_stock` title, which is the ordinary "sold out" case,
 * not "coming soon".
 */
function flagFor(book: ApiBook): BookFlag | undefined {
  if (book.availability === "coming_soon") return "coming-soon";
  if (book.availability === "pre_order") return "pre-order";
  if (book.stockQuantity <= LAST_COPY_AT) return "last-copy";
  if (book.isFeatured) return "editors-pick";
  return undefined;
}

/**
 * Credited authors as one line.
 *
 * Joined with a comma rather than localised into "A and B": the card gives
 * this line 13px on one row, and a book with three authors is a truncation
 * problem in any language before it is a grammar one.
 */
function credit(authors: string[]): string {
  return authors.join(", ");
}

/**
 * The view model for one book.
 *
 * `locale` is required because the href is locale-prefixed and a card that
 * links to an unprefixed path costs a full reload through the locale-detection
 * redirect in proxy.ts — the exact reason routes.ts exists.
 */
/**
 * `publishedDate` is optional here because this function also renders the
 * detail page's buy card — `BookDetail` extends `BookSummary` with it, and
 * it is the source for a `pre_order` book's "ships around" note. A plain
 * catalog card has no use for it, so `flag` alone (not `expectedShipDate`)
 * is what every card actually renders off.
 */
export function toBookSummary(
  book: ApiBook & { publishedDate?: string | null },
  locale: string,
): BookSummary {
  return {
    /* The API's UUID, not the slug. The cart persists whatever id it is given
       and checkout resolves ids against the books table, so the card has to
       hand the cart the key the server will recognise. The slug travels in the
       href, where a customer can read it. */
    id: book.id,
    title: book.title,
    author: credit(book.authors),
    priceCents: book.priceCents,
    href: routes(locale).book(book.slug),
    /* An empty string is a missing cover, not a cover at "". BookCover draws
       its fallback panel off `undefined` and would render a broken image off
       the empty string. */
    coverUrl: book.coverImageUrl || undefined,
    flag: flagFor(book),
    /* A coming-soon book always carries zero stock by design (enforced
       server-side) but is not "sold out" — it was never orderable to begin
       with, and dimming it the same way a genuinely depleted title is dimmed
       reads as a broken image rather than a merchandising signal. */
    soldOut: book.availability !== "coming_soon" && book.stockQuantity === 0,
    rating: book.rating ?? undefined,
    ratingCount: book.ratingCount ?? undefined,
    expectedShipDate:
      book.availability === "pre_order" ? (book.publishedDate ?? undefined) : undefined,
  };
}

export function toBookSummaries(books: ApiBook[], locale: string): BookSummary[] {
  return books.map((book) => toBookSummary(book, locale));
}
