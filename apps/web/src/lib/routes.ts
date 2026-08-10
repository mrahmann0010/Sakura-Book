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
    order: (id: string) => `${base}/orders/${id}`,
    orders: `${base}/orders`,
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
