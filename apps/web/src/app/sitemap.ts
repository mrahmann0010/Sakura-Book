import type { MetadataRoute } from "next";

import { locales } from "@/i18n/settings";
import { listBooks } from "@/lib/api/catalog";
import { toSearchParams } from "@/lib/catalog";
import { indexableFacets } from "@/lib/seo";
import { localeAlternates, siteUrl } from "@/lib/site";

/* --------------------------------------------------------------------------
   /sitemap.xml

   Three locales × (home, catalog, every level/skill shelf, every book, the
   policy pages). Each entry carries its hreflang siblings in
   `alternates.languages`, so the three locale trees are declared as
   translations of one page rather than crawled as three shops.

   Cart, checkout, orders and waitlist invites are absent on purpose: they are
   per-shopper views and are marked noindex on the pages themselves. A sitemap
   listing them would contradict that.
   -------------------------------------------------------------------------- */

/** Regenerated hourly. The shelf's own data cache is 60s; a sitemap does not
    need to be fresher than a crawler's revisit interval. */
export const revalidate = 3600;

/** Pages of the catalogue to walk. Guards against a runaway loop if the API
    ever reports a page count it cannot serve. */
const MAX_PAGES = 50;

/**
 * Pages with no data behind them, and how often each actually changes.
 *
 * `changeFrequency` is a hint a crawler is free to ignore, and it ignores it
 * fastest when it is wrong: the whole sitemap used to claim `daily`, policy
 * pages included, which is a claim contradicted by every subsequent fetch.
 * Stating the real cadence is the only version of this field worth sending.
 */
const STATIC_PAGES: { path: string; priority: number; changeFrequency: Changefreq }[] = [
  { path: "", priority: 1, changeFrequency: "daily" },
  { path: "/catalog", priority: 0.9, changeFrequency: "daily" },
  { path: "/contact", priority: 0.4, changeFrequency: "yearly" },
  { path: "/refund-policy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/privacy-policy", priority: 0.2, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.2, changeFrequency: "yearly" },
];

type Changefreq = NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;

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

  /* No `lastModified`.
     It used to be `new Date()` on every entry, set at regeneration time —
     which told a crawler that all 21 URLs, the privacy policy among them, had
     changed within the hour, every hour. A `lastmod` that moves without the
     page moving is worse than none: Google's documented behaviour is to stop
     trusting the field for the whole site once it is seen to be unreliable,
     and the one place a real date would earn its keep is a book whose price
     just changed. The catalog contract carries no `updatedAt` for a book (see
     `bookSummarySchema`), so there is no honest date to send yet — adding that
     column is the fix, and until then the field is omitted rather than
     fabricated. */
  const entry = (
    path: string,
    priority: number,
    changeFrequency: Changefreq,
  ): MetadataRoute.Sitemap =>
    locales.map((locale) => ({
      url: `${siteUrl()}/${locale}${path}`,
      changeFrequency,
      priority,
      alternates: { languages: localeAlternates(locale, path).languages },
    }));

  return [
    ...STATIC_PAGES.flatMap(({ path, priority, changeFrequency }) =>
      entry(path, priority, changeFrequency),
    ),

    /* The level and skill shelves — `/catalog?genre=n5` and friends.

       These are the shop's category pages (see lib/seo.ts for why they are
       query strings rather than routes of their own), and they are the URLs
       that target the queries the business is actually for: "JLPT N5 বই",
       "জাপানি কানজি শেখার বই". They outrank the book pages in priority
       because a learner searching a level is further from a decision than one
       searching a title, and this is the page that meets them.

       `toSearchParams` builds the query, not a template string, so the
       sitemap's URLs are byte-identical to the ones the facet links and the
       breadcrumbs emit. A sitemap entry that differs from the linked URL by a
       parameter order is a second URL for the same page. */
    ...indexableFacets.flatMap((slug) =>
      entry(`/catalog${toSearchParams({ genres: [slug] })}`, 0.85, "weekly"),
    ),

    /* `weekly`, against the `daily` this used to claim. A title's price and
       stock can change any day, but its page — description, cover, metadata —
       changes when staff edit it, which is not daily. */
    ...slugs.flatMap((slug) => entry(`/books/${slug}`, 0.8, "weekly")),
  ];
}
