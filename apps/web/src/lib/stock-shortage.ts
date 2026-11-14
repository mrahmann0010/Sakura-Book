import type { CartItem, CartQuoteRejection } from "@sakura/contracts";

import { ApiError } from "@/lib/api/client";
import type { CartLine } from "@/lib/cart";

/* --------------------------------------------------------------------------
   A cart line asking for more copies than this shopper can have.

   Two sources, one shape. The quote says so ahead of time — a priced line
   whose quantity is above its `available`, or a line rejected outright — and
   the order endpoint says so after the fact, when the guarded decrement or
   the reprice refuses. The page draws both the same way, because to the
   shopper they are the same problem with the same two ways out: take fewer,
   or take none.

   Before this existed the quote's warning went unread (the stepper simply
   grew its ceiling to match the quantity) and the order's refusal was shown
   as the server's English — "Book 2ff1c06a-…: requested 3, 1 available" — on
   the step where the shopper had just sent the money.
   -------------------------------------------------------------------------- */

export type StockShortage = {
  bookId: string;
  /** Null for a line the quote rejected outright: a rejection carries no title. */
  title: string | null;
  requested: number;
  /** Copies this shopper can still have. Zero means sold out — remove, not reduce. */
  available: number;
};

/**
 * What the current quote already says will not go through.
 *
 * `entries` decides which rejections still matter: the quote lags the cart by
 * one round-trip, and a line the shopper has just removed must not be
 * reported back to them as a problem.
 */
export function shortagesFromCart(
  lines: CartLine[],
  rejected: CartQuoteRejection[],
  entries: CartItem[],
): StockShortage[] {
  const wanted = new Map(entries.map((entry) => [entry.bookId, entry.quantity]));
  const shortages: StockShortage[] = [];

  for (const line of lines) {
    const requested = wanted.get(line.book.id);
    if (requested === undefined || line.available === null) continue;
    if (requested <= line.available) continue;

    shortages.push({
      bookId: line.book.id,
      title: line.book.title,
      requested,
      available: line.available,
    });
  }

  for (const rejection of rejected) {
    const requested = wanted.get(rejection.bookId);
    if (requested === undefined) continue;

    shortages.push({
      bookId: rejection.bookId,
      title: null,
      requested,
      // NOT_FOUND and UNAVAILABLE carry no count, and both mean none to sell.
      available: rejection.available ?? 0,
    });
  }

  return shortages;
}

/**
 * The shortages an order refusal names, or null when the refusal was about
 * something else.
 *
 * Two codes. OUT_OF_STOCK is the decrement losing a race (409), and names one
 * book with its count. CART_NOT_ORDERABLE is the reprice refusing before any
 * decrement (422), and lists every line it rejected. Titles are filled from
 * `lines` where the quote has them.
 */
export function shortagesFromError(
  error: unknown,
  lines: CartLine[],
  entries: CartItem[],
): StockShortage[] | null {
  if (!(error instanceof ApiError)) return null;

  const details = error.body?.details;
  const titleOf = (bookId: string) =>
    lines.find((line) => line.book.id === bookId)?.book.title ?? null;
  const requestedOf = (bookId: string) =>
    entries.find((entry) => entry.bookId === bookId)?.quantity ?? 0;

  if (error.code === "OUT_OF_STOCK") {
    const bookId = details?.bookId;
    if (typeof bookId !== "string") return null;

    return [
      {
        bookId,
        title: titleOf(bookId),
        requested: count(details?.requested) ?? requestedOf(bookId),
        available: count(details?.available) ?? 0,
      },
    ];
  }

  if (error.code === "CART_NOT_ORDERABLE") {
    const rejected = Array.isArray(details?.rejected) ? details.rejected : [];
    const shortages = rejected.flatMap((row: unknown): StockShortage[] => {
      if (!row || typeof row !== "object") return [];
      const { bookId, available } = row as { bookId?: unknown; available?: unknown };
      if (typeof bookId !== "string") return [];

      return [
        {
          bookId,
          title: titleOf(bookId),
          requested: requestedOf(bookId),
          available: count(available) ?? 0,
        },
      ];
    });

    return shortages.length > 0 ? shortages : null;
  }

  return null;
}

/**
 * The quote's view first, then whatever the refusal named that the quote has
 * not caught up with yet — one row per book either way.
 */
export function mergeShortages(live: StockShortage[], refused: StockShortage[]): StockShortage[] {
  const seen = new Set(live.map((shortage) => shortage.bookId));
  return [...live, ...refused.filter((shortage) => !seen.has(shortage.bookId))];
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}
