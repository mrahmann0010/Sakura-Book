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
      disallow: ["/api/", "/*/cart", "/*/checkout", "/*/orders", "/*/playground"],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  };
}
