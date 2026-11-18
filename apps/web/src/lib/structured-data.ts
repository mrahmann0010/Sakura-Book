import type { Locale } from "@/i18n/settings";
import { routes } from "@/lib/routes";
import { siteUrl } from "@/lib/site";

/* --------------------------------------------------------------------------
   schema.org graphs.

   The book page has carried a `Book` + `Offer` graph for a while; nothing else
   on the shop carried any, which left three things on the table:

     - Organization / WebSite, which is what a knowledge panel and a sitelinks
       search box are built from, and the only place the shop can state that it
       is the same business as nihonovaacademy.com.
     - BreadcrumbList, which is what replaces the naked URL in a result with a
       readable trail. The pages already *draw* breadcrumbs; drawing them is
       not what Google reads.
     - ItemList on the catalog, which tells a crawler the page is a listing of
       the N books it links to rather than a page that happens to have links.

   One rule governs everything in this file: nothing may be asserted here that
   the page does not also show a human. Every value below is either a constant
   about the business or is threaded in from the same data the page renders.
   -------------------------------------------------------------------------- */

/** Stable @id fragments, so the Organization and WebSite nodes can reference
    each other instead of being repeated per page. */
const ORG_ID = "#organization";
const SITE_ID = "#website";

/** The parent brand. Declared via `sameAs`/`parentOrganization` rather than
    assumed: the shop and the academy are one business to a searcher, and
    nothing in the markup said so. */
const PARENT_SITE = "https://www.nihonovaacademy.com";

export function organizationJsonLd() {
  return {
    "@type": "Organization",
    "@id": `${siteUrl()}/${ORG_ID}`,
    name: "Nihonova Books",
    url: siteUrl(),
    /* The app's own icon. Google's logo guidance prefers a raster file; see
       apps/web/SEO/technical-seo-audit.md for that as an outstanding item. */
    logo: `${siteUrl()}/icon.svg`,
    sameAs: [PARENT_SITE],
    parentOrganization: { "@type": "Organization", name: "Nihonova Academy", url: PARENT_SITE },
    /* The shop ships within Bangladesh only (see lib/bd-geo.ts, which is the
       whole address vocabulary the checkout offers). Stating it keeps the
       business out of results it cannot serve. */
    areaServed: { "@type": "Country", name: "Bangladesh" },
  };
}

export function webSiteJsonLd(locale: Locale) {
  return {
    "@type": "WebSite",
    "@id": `${siteUrl()}/${SITE_ID}`,
    url: `${siteUrl()}${routes(locale).home}`,
    name: "Nihonova Books",
    inLanguage: locale,
    publisher: { "@id": `${siteUrl()}/${ORG_ID}` },
    /* The catalog's `?q=` is a real, server-rendered search — the same
       parameter `parseSearchParams` reads — so this is a search box Google can
       honestly offer in a result, not a decorative claim. */
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${siteUrl()}${routes(locale).catalog}?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

/**
 * A breadcrumb trail, from the same `{ href, label }` items the visible
 * `<Breadcrumbs>` is given.
 *
 * The last crumb carries no `item`: it is the current page, and Google's own
 * guidance is to leave the final URL off rather than self-reference it.
 */
export function breadcrumbJsonLd(items: { href?: string; label: string }[]) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.label,
      ...(crumb.href ? { item: `${siteUrl()}${crumb.href}` } : {}),
    })),
  };
}

/**
 * The catalog grid, as a list.
 *
 * URLs only, no prices or names: a listing page's job in structured data is to
 * declare its members and their order, and the per-book facts belong on the
 * book page where they are rendered. Repeating a price here would be a second
 * copy to go stale against the first.
 */
export function itemListJsonLd(urls: string[], name: string) {
  return {
    "@type": "ItemList",
    name,
    numberOfItems: urls.length,
    itemListElement: urls.map((url, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url,
    })),
  };
}

/**
 * Wraps nodes in an `@graph`, so everything one component knows goes out as
 * one document rather than one script per node.
 *
 * Not one script per *page*: the catalog emits two, because its breadcrumb is
 * known at the top of the page and its ItemList only inside the streamed
 * `<Suspense>` boundary that has the books. Merging them would mean holding
 * the page's markup back until the fetch resolved — paying a visible render
 * cost to tidy something a crawler does not mind. Multiple `ld+json` blocks on
 * one page are valid and Google reads them together; what matters is that two
 * blocks never state the same node differently, which is why each one is built
 * from the data its own component rendered.
 */
export function graph(...nodes: object[]) {
  return { "@context": "https://schema.org", "@graph": nodes };
}
