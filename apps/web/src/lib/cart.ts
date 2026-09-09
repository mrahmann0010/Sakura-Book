import type { CartQuote } from "@sakura/contracts";

import type { BookSummary } from "@/components/domain";

import { fileUrl } from "@/lib/storage-url";

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
   Delivery policy — server-owned, with no client copy.

   These numbers decide what a customer is charged, which makes them shop
   policy, which makes a browser bundle the wrong place for them: anyone can
   edit a constant in devtools and send us back the total it produced. They
   live server-side, in DELIVERY_FLAT_CENTS / FREE_DELIVERY_THRESHOLD_CENTS
   (overridden by the shop settings row), and reach the client two ways:
   `POST /v1/cart/quote`, which prices a cart and carries
   `freeDeliveryThresholdCents` back with the totals, and
   `GET /v1/shipping/regions`, for a page with no cart to price — the book
   detail page's "free delivery over X" line.

   There used to be a FREE_DELIVERY_THRESHOLD / DELIVERY_FLAT pair here,
   described as a presentation fallback for the pre-quote paint. They were not
   one: the cart page priced its whole summary off them, and they were written
   as taka against a formatter that reads minor units, so a ৳60 postage rate on
   a ৳1,500 threshold rendered as "৳3.50, free over ৳30" — a total the shopper
   was then not charged. A fallback that can be shown as if it were the answer
   is just a second, wrong policy. There is now no client-side default: a page
   that needs these numbers asks for them, and shows nothing until they land.
   -------------------------------------------------------------------------- */

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
  /**
   * Spend at or above this and postage is waived — the figure the "free over
   * X" line quotes. Minor units, straight off the quote.
   *
   * Null until a quote has come back, because there is no client-side default
   * to fall back to (see the delivery policy note above). A caller renders the
   * promise only once it has a number, rather than guessing at one.
   */
  freeDeliveryThreshold: number | null;
};

/** Before the first quote lands, and for a cart with nothing in it. */
export const emptyCart: Cart = {
  lines: [],
  isEmpty: true,
  freeDeliveryThreshold: null,
  ...zeroTotals(),
};

/**
 * Turns a priced `POST /cart/quote` response into the shape the cart and
 * checkout pages render. The quote has already done the resolving — a stale
 * or delisted id simply has no line here, listed instead in `quote.rejected`
 * for the page to explain — and the pricing, so the totals below are the
 * server's numbers, not a client recomputation of them.
 */
export function cartFromQuote(quote: CartQuote): Cart {
  const lines: CartLine[] = quote.lines.map((line) => ({
    book: {
      id: line.bookId,
      title: line.title,
      author: line.authors.join(", "),
      priceCents: line.unitPriceCents,
      href: `/books/${line.slug}`,
      /* Through `fileUrl` for the same reason book-view.ts does it: the
         quote carries whatever URL is stored on the book, which for an older
         title is a Supabase one needing the legacy proxy. See
         lib/storage-url.ts. */
      coverUrl: fileUrl(line.coverImageUrl) ?? undefined,
      flag: line.availability === "pre_order" ? "pre-order" : undefined,
      expectedShipDate: line.expectedShipDate ?? undefined,
    },
    quantity: line.quantity,
    unitPrice: line.unitPriceCents,
    lineTotal: line.lineTotalCents,
  }));

  return {
    lines,
    isEmpty: lines.length === 0,
    lineCount: quote.lineCount,
    itemCount: quote.itemCount,
    subtotal: quote.subtotalCents,
    deliveryBase: quote.deliveryBaseCents,
    delivery: quote.deliveryCents,
    deliveryCredit: quote.deliveryCreditCents,
    total: quote.totalCents,
    freeDeliveryThreshold: quote.freeDeliveryThresholdCents,
  };
}

/**
 * An all-zero totals block — a cart with nothing in it, and the shape a page
 * renders before its first quote arrives.
 *
 * This replaces `priceCart(lines)`, which applied the deleted client-side
 * delivery constants to a list of lines. Nothing prices a cart in the browser
 * any more: the only totals on screen are the ones the server quoted, so the
 * cart page and checkout cannot show two different answers, and neither can
 * show an answer the customer will not be charged.
 */
export function zeroTotals(): CartTotals {
  return {
    lineCount: 0,
    itemCount: 0,
    subtotal: 0,
    deliveryBase: 0,
    delivery: 0,
    deliveryCredit: 0,
    total: 0,
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
    /**
     * "Free over X". Null when the caller has no threshold to name yet — no
     * quote has come back — in which case the waiver row is left off rather
     * than worded around a figure nobody knows.
     */
    deliveryFree: string | null;
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

  if (totals.deliveryCredit > 0 && !labels.deliveryUnknown && labels.deliveryFree) {
    lines.push({
      key: "delivery-credit",
      label: labels.deliveryFree,
      value: formatCredit(totals.deliveryCredit, locale),
      tone: "credit",
    });
  }

  return lines;
}
