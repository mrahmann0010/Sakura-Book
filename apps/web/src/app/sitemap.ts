import type { MetadataRoute } from "next";

import { locales } from "@/i18n/settings";
import { listBooks } from "@/lib/api/catalog";
import { localeAlternates, siteUrl } from "@/lib/site";

/* --------------------------------------------------------------------------
   /sitemap.xml

   Three locales × (home, catalog, every book). Each entry carries its hreflang
   siblings in `alternates.languages`, so the three locale trees are declared
   as translations of one page rather than crawled as three shops.

   Cart, checkout and orders are absent on purpose: they are per-shopper views
   and are marked noindex on the pages themselves. A sitemap listing them would
   contradict that.
   -------------------------------------------------------------------------- */

/** Regenerated hourly. The shelf's own data cache is 60s; a sitemap does not
    need to be fresher than a crawler's revisit interval. */
export const revalidate = 3600;

/** Pages of the catalogue to walk. Guards against a runaway loop if the API
    ever reports a page count it cannot serve. */
const MAX_PAGES = 50;

async function allBookSlugs(): Promise<string[]> {
  const slugs: string[] = [];

  try {
    let page = 1;
    let totalPages = 1;

    do {
      const list = await listBooks({ q: "", genres: [], sort: "recent", page });
      totalPages = list.totalPages;
      for (const book of list.items) slugs.push(book.slug);
      page += 1;
    } while (page <= totalPages && page <= MAX_PAGES);
  } catch {
    /* The API being down must not 500 the sitemap. A sitemap of the static
       routes is worth more to a crawler than an error page, and the next
       revalidation picks the books back up. */
  }

  return slugs;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const slugs = await allBookSlugs();
  const now = new Date();

  const entry = (path: string, priority: number): MetadataRoute.Sitemap =>
    locales.map((locale) => ({
      url: `${siteUrl()}/${locale}${path}`,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority,
      alternates: { languages: localeAlternates(locale, path).languages },
    }));

  return [
    ...entry("", 1),
    ...entry("/catalog", 0.9),
    ...slugs.flatMap((slug) => entry(`/books/${slug}`, 0.8)),
  ];
}
