import type { Order } from "@sakura/contracts";

import { locales } from "@/i18n/settings";

import type { CartLine, CartTotals } from "./cart";
import { CURRENCY } from "./money";

/* --------------------------------------------------------------------------
   Google Analytics 4 (gtag.js)

   The snippet Google hands you assumes a page that loads once. This app is a
   Next.js App Router SPA: the first paint is a server render, and every click
   after that is a client-side navigation with no document load behind it. Drop
   the snippet in as-is and GA records exactly one page_view per session — the
   landing page — and nothing about the catalog, cart or checkout the visitor
   actually walked through.

   So the config here sets `send_page_view: false` and `PageViewTracker` sends
   every view by hand, the first one included. That is the whole reason the
   automatic pageview is switched off: not to send fewer, but to stop the
   initial load being counted twice once the tracker starts sending its own.
   -------------------------------------------------------------------------- */

/**
 * Read through a function rather than a module constant, for the same reason
 * `siteUrl()` and `apiOrigin()` are: evaluated per render, so a container
 * built without the variable still starts.
 *
 * Returns undefined when unset, and every caller treats that as "analytics is
 * off" — a local dev run or a preview deploy should not be posting events into
 * the production property, and a missing ID must degrade to no tracking rather
 * than to a broken page.
 */
export function gaMeasurementId(): string | undefined {
  const id = process.env.G_ANALYTICS?.trim();
  return id ? id : undefined;
}

/* The measurement ID reaches the browser as a prop rather than a NEXT_PUBLIC_
   var, so `G_ANALYTICS` stays the one name in the .env files. It is not a
   secret either way — it ships in the page source of every GA site on the
   web — this is only about not having two names for one value. */

type GtagParams = Record<string, unknown>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * Every send goes through here so that a page with analytics switched off — or
 * one where the script is still in flight, or was blocked outright — is a
 * no-op instead of a `gtag is not a function` crash inside a render.
 */
function gtag(...args: unknown[]) {
  if (typeof window === "undefined") return;
  window.gtag?.(...args);
}

/**
 * `page_path` is not a GA4 field — it was Universal Analytics'. GA4 derives the
 * page and its query from `page_location`, so that is the one that has to be
 * right; sending a path alone produces reports keyed on "(not set)".
 */
export function trackPageView(params: { title: string; location: string; contentGroup: string }) {
  gtag("event", "page_view", {
    page_title: params.title,
    page_location: params.location,
    content_group: params.contentGroup,
  });
}

/** Ecommerce and interaction events — `trackEvent("add_to_cart", { ... })`. */
export function trackEvent(name: string, params: GtagParams = {}) {
  gtag("event", name, params);
}

/**
 * The section of the shop a URL belongs to, as GA4's built-in `content_group`
 * dimension — so the reports group the three locale copies of the catalog into
 * one row instead of three, which is what the hreflang set already says they
 * are.
 *
 * `/en/books/some-slug` → "books". `/bn` → "home".
 */
export function contentGroupFor(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);

  /* Drop the locale prefix. Guarded rather than assumed: `usePathname()` runs
     on the not-yet-redirected URL too, which has no prefix on it yet. */
  if (segments[0] && (locales as readonly string[]).includes(segments[0])) segments.shift();

  return segments[0] ?? "home";
}

/**
 * Admin is the shop's own staff looking at their own orders. Counting those
 * visits inflates exactly the sessions an owner reads the numbers to
 * understand, so nothing under `/[locale]/admin` is ever sent.
 */
export function isTrackablePath(pathname: string): boolean {
  return contentGroupFor(pathname) !== "admin";
}

/* --------------------------------------------------------------------------
   Ecommerce

   GA4's ecommerce reports are not built from pageviews — they are built from a
   named set of events carrying an `items` array, and a funnel is only as
   complete as the events actually sent. This shop sends the five that matter:
   view_item → add_to_cart → begin_checkout → purchase, plus view_cart for the
   one page between them.

   Two rules hold everything here together:

   1. Amounts leave this app as integers of minor units everywhere else (see
      lib/money.ts). GA4 wants a decimal major unit — 1400 → 14.00 — so this is
      the one file allowed to divide by 100, and `major()` is the only place
      that does it.

   2. Nothing is recomputed. `purchase` is built from the order the API
      returned, not from the cart that produced it: the server re-prices every
      order regardless of what the browser sent, so the cart's total is a
      client-side guess at revenue and the order's is the money. A GA property
      whose revenue disagrees with the shop's own books is worse than one with
      no revenue in it at all.
   -------------------------------------------------------------------------- */

/** Minor units → the decimal GA4 expects. Rounded, because 1/3 of a taka is
    not a price and GA4 stores what it is given. */
const major = (minor: number) => Number((minor / 100).toFixed(2));

type GaItem = {
  item_id: string;
  item_name: string;
  price: number;
  quantity: number;
  index?: number;
};

/**
 * `index` is the position in the list, which is what makes GA4 able to say a
 * shopper bought the fourth book on the shelf rather than merely that they
 * bought it.
 */
function itemsFromCartLines(lines: CartLine[]): GaItem[] {
  return lines.map((line, index) => ({
    item_id: line.book.id,
    item_name: line.book.title,
    price: major(line.unitPrice),
    quantity: line.quantity,
    index,
  }));
}

/**
 * Order lines carry `bookId: null` for a title deleted since it was bought —
 * the line keeps its own snapshot of what was sold (see orderLineSchema). The
 * slug stands in so the item still appears in the report rather than being
 * dropped out of a purchase whose total already counts it.
 */
function itemsFromOrderLines(lines: Order["lines"]): GaItem[] {
  return lines.map((line, index) => ({
    item_id: line.bookId ?? line.slug ?? line.title,
    item_name: line.title,
    price: major(line.unitPriceCents),
    quantity: line.quantity,
    index,
  }));
}

/** A book's detail page. */
export function trackViewItem(book: { id: string; title: string; priceCents: number }) {
  trackEvent("view_item", {
    currency: CURRENCY,
    value: major(book.priceCents),
    items: [{ item_id: book.id, item_name: book.title, price: major(book.priceCents), quantity: 1 }],
  });
}

/**
 * Sent on the dispatch, not on the requote that follows it — an `add_to_cart`
 * that waited for the server to price the new cart would be lost entirely by a
 * shopper who taps Buy Now and is navigated to checkout before it lands.
 *
 * `price` is therefore whatever the calling page had on screen. That is the
 * one number in this file the server has not confirmed, and it is only ever a
 * funnel figure: revenue is `purchase`, and `purchase` reads the order.
 */
export function trackAddToCart(item: {
  id: string;
  title?: string;
  priceCents?: number;
  quantity: number;
}) {
  const price = item.priceCents === undefined ? undefined : major(item.priceCents);

  trackEvent("add_to_cart", {
    currency: CURRENCY,
    ...(price === undefined ? {} : { value: price * item.quantity }),
    items: [
      {
        item_id: item.id,
        /* GA4 accepts an item with an id and no name; it reports it as
           "(not set)", which is legible enough to chase down. */
        ...(item.title ? { item_name: item.title } : {}),
        ...(price === undefined ? {} : { price }),
        quantity: item.quantity,
      },
    ],
  });
}

/** Removal from the cart page, and the stepper reaching zero. */
export function trackRemoveFromCart(line: CartLine) {
  trackEvent("remove_from_cart", {
    currency: CURRENCY,
    value: major(line.lineTotal),
    items: itemsFromCartLines([line]),
  });
}

/** The cart page, once the server has priced what is on it. */
export function trackViewCart(cart: CartTotals & { lines: CartLine[] }) {
  trackEvent("view_cart", {
    currency: CURRENCY,
    value: major(cart.subtotal),
    items: itemsFromCartLines(cart.lines),
  });
}

/** The checkout page, same shape — the step GA4 measures cart abandonment on. */
export function trackBeginCheckout(cart: CartTotals & { lines: CartLine[] }) {
  trackEvent("begin_checkout", {
    currency: CURRENCY,
    value: major(cart.subtotal),
    items: itemsFromCartLines(cart.lines),
  });
}

/**
 * The order, straight from the API's response.
 *
 * `value` is the order total including delivery, which is what GA4 means by
 * revenue, and `transaction_id` is the order number the customer quotes on the
 * phone — so a row in GA can be matched against a row in the admin table
 * without a lookup table between them. GA4 also uses `transaction_id` to
 * discard duplicates, which is the backstop for the send-once guard at the
 * call site.
 */
const reportedPurchases = new Set<string>();

export function trackPurchase(order: Order) {
  /* Module scope rather than a ref on the checkout component: the guard has to
     outlive that component, or an order reported once would be reported again
     by a remount — and double-counted revenue is the one reporting bug nobody
     catches, because the number still looks plausible. */
  if (reportedPurchases.has(order.orderNumber)) return;
  reportedPurchases.add(order.orderNumber);

  trackEvent("purchase", {
    transaction_id: order.orderNumber,
    currency: order.currency,
    value: major(order.totalCents),
    shipping: major(order.deliveryCents),
    ...(order.couponCode ? { coupon: order.couponCode } : {}),
    items: itemsFromOrderLines(order.lines),
  });
}
