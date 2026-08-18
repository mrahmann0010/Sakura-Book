import type { BookSummary } from "@/components/domain";

import { getBookById } from "./books";
import { formatCredit, formatMoney } from "./money";

/* --------------------------------------------------------------------------
   Cart pricing

   Pure. No React, no Redux, no fetching — it takes the persisted `{ bookId,
   quantity }` pairs the cart slice owns and returns everything both pages
   need to render: resolved lines, and a priced total.

   The cart page and the checkout page share this one derivation deliberately.
   A checkout that recomputes its own subtotal is a checkout that will one day
   disagree with the cart, and the wireframe's read-only recap only earns its
   "read-only" if it is reading the same numbers.
   -------------------------------------------------------------------------- */

/* --------------------------------------------------------------------------
   Delivery policy — no longer authoritative.

   These two numbers decide what a customer is charged, which makes them shop
   policy, which makes a browser bundle the wrong place for them: anyone can
   edit a constant in devtools and send us back the total it produced. They now
   live server-side, in DELIVERY_FLAT_CENTS / FREE_DELIVERY_THRESHOLD_CENTS,
   behind POST /v1/cart/quote, and checkout re-prices from them regardless of
   what arrives in the request.

   What is left here is a *presentation* fallback: the figures the cart page
   renders before the first quote comes back, and the threshold the "spend X
   more for free delivery" line quotes. The quote response carries
   `freeDeliveryThresholdCents` and overrides them. When the cart page is wired
   to the endpoint (it still reads the placeholder catalogue), these become the
   loading state and nothing else.
   -------------------------------------------------------------------------- */

/** Presentation fallback. Authority: FREE_DELIVERY_THRESHOLD_CENTS on the API. */
export const FREE_DELIVERY_THRESHOLD = 3000;

/** Presentation fallback. Authority: DELIVERY_FLAT_CENTS on the API. */
export const DELIVERY_FLAT = 350;

export type CartEntry = {
  bookId: string;
  quantity: number;
};

export type CartLine = {
  book: BookSummary;
  quantity: number;
  /** Minor units. */
  unitPrice: number;
  lineTotal: number;
};

export type CartTotals = {
  /** Distinct titles. */
  lineCount: number;
  /** Books, counting quantity — what the header badge and "3 items" show. */
  itemCount: number;
  subtotal: number;
  /** What postage would cost before the threshold is applied. */
  deliveryBase: number;
  /** Charged postage: zero once the threshold is met. */
  delivery: number;
  /** The waived amount, shown as a credit row. Zero when nothing is waived. */
  deliveryCredit: number;
  total: number;
};

export type Cart = CartTotals & {
  lines: CartLine[];
  isEmpty: boolean;
};

/**
 * Resolves persisted entries against the catalogue.
 *
 * Unknown ids are dropped rather than thrown on: a cart survives in
 * localStorage across deploys, so it will eventually hold a book that has been
 * delisted, and that must degrade to "the book quietly left the cart", never a
 * crash on the cart page.
 *
 * `lookup` is injectable so a test — or the API-backed version — can supply
 * its own resolver without touching callers.
 */
export function buildCart(
  entries: CartEntry[],
  lookup: (bookId: string) => BookSummary | undefined = getBookById,
): Cart {
  const lines: CartLine[] = [];

  for (const entry of entries) {
    const book = lookup(entry.bookId);
    if (!book || entry.quantity < 1) continue;

    const unitPrice = book.priceCents;
    lines.push({
      book,
      quantity: entry.quantity,
      unitPrice,
      lineTotal: unitPrice * entry.quantity,
    });
  }

  return { lines, isEmpty: lines.length === 0, ...priceCart(lines) };
}

/** The totals block. Split out so a server-priced cart can reuse the policy. */
export function priceCart(lines: CartLine[]): CartTotals {
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const itemCount = lines.reduce((count, line) => count + line.quantity, 0);

  /* An empty cart is charged nothing — otherwise the empty page would quote
     postage on nothing at all. */
  const deliveryBase = lines.length === 0 ? 0 : DELIVERY_FLAT;
  const waived = subtotal >= FREE_DELIVERY_THRESHOLD;

  return {
    lineCount: lines.length,
    itemCount,
    subtotal,
    deliveryBase,
    delivery: waived ? 0 : deliveryBase,
    deliveryCredit: waived ? deliveryBase : 0,
    total: subtotal + (waived ? 0 : deliveryBase),
  };
}

/**
 * The rows the summary rail draws, already worded and formatted.
 *
 * Both pages show the same ladder — subtotal, delivery, any waiver — so the
 * ladder is derived once here instead of being re-listed in two JSX trees
 * that would drift apart. Labels come in from the caller so translation stays
 * in the page, where the `t` function lives.
 */
export type SummaryLineTone = "default" | "credit";

export type SummaryLine = {
  key: string;
  label: string;
  value: string;
  tone: SummaryLineTone;
};

export function summaryLines(
  totals: CartTotals,
  labels: {
    subtotal: (count: number) => string;
    delivery: string;
    deliveryFree: string;
    /** Shown in place of a figure while the address is still unknown. */
    deliveryUnknown?: string;
  },
  locale = "en-GB",
): SummaryLine[] {
  const lines: SummaryLine[] = [
    {
      key: "subtotal",
      label: labels.subtotal(totals.itemCount),
      value: formatMoney(totals.subtotal, locale),
      tone: "default",
    },
    {
      key: "delivery",
      label: labels.delivery,
      value: labels.deliveryUnknown ?? formatMoney(totals.deliveryBase, locale),
      tone: "default",
    },
  ];

  if (totals.deliveryCredit > 0 && !labels.deliveryUnknown) {
    lines.push({
      key: "delivery-credit",
      label: labels.deliveryFree,
      value: formatCredit(totals.deliveryCredit, locale),
      tone: "credit",
    });
  }

  return lines;
}
