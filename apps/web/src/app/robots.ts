import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";

/* /robots.txt — the disallow list is the crawl-budget half of the same
   decision the pages' `robots: { index: false }` makes: those keep a page out
   of the index, this keeps a crawler from spending requests on it at all.
   Both are needed; neither implies the other. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/*/cart",
        "/*/checkout",
        "/*/orders",
        "/*/playground",
        "/*/admin",
        /* One-shot waitlist tokens. Every URL under it is unique, single-use
           and already `noindex` on the page — but a token in an index or in a
           crawler's log is a claim on a copy of a book that was reserved for
           one named person, so the cheaper half of the pair matters here more
           than it does for the cart. */
        "/*/invite",
      ],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  };
}
