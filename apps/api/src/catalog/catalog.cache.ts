import type { Response } from "express";

/**
 * Cache headers for the public catalog reads.
 *
 * HTTP caching first, no Redis (§3.15): dozens of titles in Postgres with the
 * right indexes answer in under a millisecond, and an application cache in
 * front of that buys nothing while adding an invalidation bug surface.
 *
 * `s-maxage` targets a CDN and `max-age` the browser, and they differ on
 * purpose. A shared cache can be purged on deploy; a browser cannot, so a
 * customer who saw a stale price would keep seeing it for as long as we told
 * them to. Sixty seconds is short enough that a price change or a sell-out
 * corrects itself while someone is still on the page.
 *
 * `stale-while-revalidate` is the part that actually matters for a small shop:
 * it lets a CDN serve the cached shelf instantly and refresh behind the
 * request, so a cold origin is never in a customer's path.
 */
export const CATALOG_CACHE_CONTROL = "public, max-age=60, s-maxage=300, stale-while-revalidate=600";

/**
 * Stock and price are on these responses, so this is deliberately *not* a
 * long cache with an ETag revalidation dance. A 304 saves bytes we do not have
 * a problem sending; the freshness window is the whole decision here.
 */
export function cacheCatalog(response: Response): void {
  response.setHeader("Cache-Control", CATALOG_CACHE_CONTROL);
}

/**
 * Reference data — the category rail and author pages — changes when the shop's
 * staff change it, which is rarely. Cached harder for that reason, and
 * separately so that tuning the shelf's freshness cannot silently make the
 * filter rail stale for an hour.
 */
export const REFERENCE_CACHE_CONTROL =
  "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";

export function cacheReference(response: Response): void {
  response.setHeader("Cache-Control", REFERENCE_CACHE_CONTROL);
}
