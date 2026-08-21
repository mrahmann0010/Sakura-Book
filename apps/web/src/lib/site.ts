import { defaultLocale, locales, type Locale } from "@/i18n/settings";

/* --------------------------------------------------------------------------
   The canonical origin, and the alternates every page hangs off it.

   Three locales sit under `/[locale]`, which means every page of this shop
   exists at three URLs. Without `alternates` that reads to a crawler as three
   competing copies of the same shelf; with it, one canonical per locale and an
   hreflang set pointing at the siblings.
   -------------------------------------------------------------------------- */

/**
 * Read through a function, not a module constant, for the same reason
 * `apiOrigin()` is: it must be evaluated per render rather than at import, so
 * a container built without the variable still starts.
 *
 * Falls back to localhost rather than throwing — a missing site URL degrades
 * metadata, it does not break a page, and failing the render over an og:url
 * would be worse than the wrong og:url.
 */
export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

/**
 * Canonical + hreflang for one locale-agnostic path (`""`, `"/catalog"`,
 * `"/books/the-slug"` — no locale prefix, no query string).
 *
 * Query strings are deliberately not accepted: `?q=`/`?page=` views are
 * filtered slices of the same shelf, and their canonical is the clean URL.
 */
export function localeAlternates(locale: Locale, path: string = "") {
  const languages = Object.fromEntries(
    locales.map((other) => [other, `${siteUrl()}/${other}${path}`]),
  );

  return {
    canonical: `${siteUrl()}/${locale}${path}`,
    languages: {
      ...languages,
      /* The fallback a crawler uses for a language it has no entry for. */
      "x-default": `${siteUrl()}/${defaultLocale}${path}`,
    },
  };
}
