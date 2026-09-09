import type { Locale } from "@/i18n/settings";

/* --------------------------------------------------------------------------
   Routes

   Every route in this app is locale-prefixed (`/en/cart`), so no component
   should be assembling that prefix by hand — one missed prefix is a full page
   reload into the locale-detection redirect. One place to change when a path
   moves, and one place to read to see what pages exist.
   -------------------------------------------------------------------------- */

export function routes(locale: Locale | string) {
  const base = `/${locale}`;

  return {
    home: base,
    catalog: `${base}/catalog`,
    book: (id: string) => `${base}/books/${id}`,
    cart: `${base}/cart`,
    checkout: `${base}/checkout`,
    orders: `${base}/orders`,
    order: (orderNumber: string) => `${base}/orders/${encodeURIComponent(orderNumber)}`,
    refundPolicy: `${base}/refund-policy`,
    privacyPolicy: `${base}/privacy-policy`,
    terms: `${base}/terms`,
    contact: `${base}/contact`,
    notify: `${base}/notify`,
    /* Short on purpose: this path is what an SMS pays for. A Bangla invite is
       UCS-2, so the whole message gets 70 characters — `/waitlist/invite/`
       spent 17 of them saying twice what `/invite/` says once. */
    waitlistInvite: (token: string) => `${base}/invite/${encodeURIComponent(token)}`,
    /* Where a customer writes about the service. Deliberately not under
       `/reviews` — that path is left free for the listing of approved
       testimonials, so neither page has to move when the other arrives. */
    writeReview: `${base}/yourexperience`,
  } as const;
}

export type Routes = ReturnType<typeof routes>;

/** Locale-prefixes the nav/footer link tables in lib/books.ts. */
export function localizeLinks<T extends { href: string }>(
  items: T[],
  locale: Locale | string,
): T[] {
  return items.map((item) => ({
    ...item,
    /* Absolute paths get the prefix; `mailto:` and external URLs are left
       alone, which is exactly the distinction a leading slash already makes. */
    href: item.href.startsWith("/") ? `/${locale}${item.href}` : item.href,
  }));
}
