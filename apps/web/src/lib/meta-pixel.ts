/* --------------------------------------------------------------------------
   Meta Pixel (fbevents.js)

   The same pixel the academy site reports to, so both properties feed one set
   of audiences: someone who browses the shop and someone who browses the
   courses land in the same pool, and an ad can be shown to either.

   Shaped to mirror lib/analytics.ts rather than to mirror Meta's snippet. The
   snippet assumes a document load per page; this app is an App Router SPA
   where only the first view is a document load, so `MetaPixelPageView` sends
   every view by hand — exactly the reason GA is configured with
   `send_page_view: false` next door.

   Amounts arrive here in MAJOR units (14.00, not 1400). The app's rule is that
   money is integer minor units everywhere, and lib/analytics.ts is the one
   file allowed to divide by 100 — so it converts once and hands the result to
   both vendors, instead of a second file quietly owning the same rule.
   -------------------------------------------------------------------------- */

import { CURRENCY } from "./money";

declare global {
  interface Window {
    fbq?: ((...args: unknown[]) => void) & { callMethod?: (...args: unknown[]) => void };
    _fbq?: unknown;
  }
}

/**
 * Read through a function, not a module constant, for the same reason
 * `gaMeasurementId()` is: evaluated per request so a container built without
 * the variable still starts, and unset means "tracking is off" rather than a
 * broken page.
 *
 * Deliberately has no default. Hardcoding the id would mean every local dev
 * run and preview deploy firing real events into the live pixel — which would
 * poison the very audiences this exists to build, with traffic that is not
 * customers.
 */
export function metaPixelId(): string | undefined {
  const id = process.env.META_PIXEL?.trim();
  return id ? id : undefined;
}

/**
 * Every send goes through here, so a page where the pixel is switched off,
 * still loading, or blocked by an extension is a no-op rather than an
 * `fbq is not a function` thrown inside a render. A shop that cannot count its
 * visitors still sells books.
 */
function fbq(...args: unknown[]) {
  if (typeof window === "undefined") return;
  try {
    window.fbq?.(...args);
  } catch {
    /* Pixel internals failed mid-flight. Never the shopper's problem. */
  }
}

/** One standard event. `eventId` lets Meta discard a duplicate of the same one. */
function track(name: string, params: Record<string, unknown> = {}, eventId?: string) {
  if (eventId) fbq("track", name, params, { eventID: eventId });
  else fbq("track", name, params);
}

/** A view. Sent per route by `MetaPixelPageView`, first load included. */
export function pixelPageView() {
  track("PageView");
}

type PixelItem = {
  id: string;
  title: string;
  /** Major units — see the note at the top of this file. */
  price: number;
  quantity: number;
};

/**
 * Meta reads `content_ids` for retargeting and `contents` for the per-item
 * detail, and wants both on an ecommerce event. `content_type: "product"` is
 * what makes those ids resolve against a catalogue rather than being treated
 * as opaque strings.
 */
function contentsPayload(items: PixelItem[], currency: string, value: number) {
  return {
    currency,
    value,
    content_type: "product",
    content_ids: items.map((item) => item.id),
    contents: items.map((item) => ({
      id: item.id,
      quantity: item.quantity,
      item_price: item.price,
    })),
    num_items: items.reduce((sum, item) => sum + item.quantity, 0),
  };
}

/**
 * A book's detail page — the signal that builds a retargeting audience.
 *
 * The only event whose caller has no currency to hand: a detail page knows a
 * price, not a cart. The shop is single-currency, so it reads the constant
 * lib/money.ts already defines rather than inventing a second copy.
 */
export function pixelViewContent(book: { id: string; title: string; price: number }) {
  track("ViewContent", {
    ...contentsPayload([{ ...book, quantity: 1 }], CURRENCY, book.price),
    content_name: book.title,
  });
}

/**
 * `price` is optional because GA's equivalent allows it: the event is sent on
 * the dispatch, before the server has repriced the cart, so a Buy Now that
 * navigates straight to checkout still reports. When it is absent the event
 * is sent without a value rather than with a zero — a zero would land in
 * Meta's reporting as a real sale worth nothing.
 */
export function pixelAddToCart(
  item: { id: string; title?: string; price?: number; quantity: number },
  currency: string,
) {
  const hasPrice = typeof item.price === "number";

  track("AddToCart", {
    currency,
    content_type: "product",
    content_ids: [item.id],
    contents: [
      {
        id: item.id,
        quantity: item.quantity,
        ...(hasPrice ? { item_price: item.price } : {}),
      },
    ],
    num_items: item.quantity,
    ...(hasPrice ? { value: item.price! * item.quantity } : {}),
    ...(item.title ? { content_name: item.title } : {}),
  });
}

export function pixelInitiateCheckout(items: PixelItem[], currency: string, value: number) {
  track("InitiateCheckout", contentsPayload(items, currency, value));
}

/**
 * A completed order, reported once.
 *
 * Guarded in module scope rather than on a component, for the reason spelled
 * out beside GA's equivalent: a remount must not re-report an order, and
 * double-counted revenue is the reporting bug nobody catches because the
 * number still looks plausible. `eventID` carries the order number so Meta
 * discards a duplicate even across a reload, where module state is gone.
 */
const reportedOrders = new Set<string>();

export function pixelPurchase(order: {
  orderNumber: string;
  currency: string;
  value: number;
  items: PixelItem[];
}) {
  if (reportedOrders.has(order.orderNumber)) return;
  reportedOrders.add(order.orderNumber);

  track(
    "Purchase",
    contentsPayload(order.items, order.currency, order.value),
    `Purchase-${order.orderNumber}`,
  );
}
