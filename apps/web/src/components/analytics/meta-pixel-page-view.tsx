"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { isTrackablePath } from "@/lib/analytics";
import { pixelPageView } from "@/lib/meta-pixel";

/**
 * Sends one Meta `PageView` per route, the first load included.
 *
 * The base snippet fires a PageView of its own on the document load, so this
 * component is mounted *instead of* letting it — `meta-pixel.tsx` initialises
 * the pixel without that call. Otherwise the landing view would be counted
 * twice and every later route not at all.
 *
 * Watches the query string as well as the path, for the same reason
 * `PageViewTracker` does: `/catalog?q=n5` and `/catalog?page=2` are different
 * views of the shelf, reached without the pathname changing.
 */
export function MetaPixelPageView() {
  const pathname = usePathname();
  /* Read as a string, not as the object: `useSearchParams()` returns a fresh
     identity every render, so depending on it directly would re-send on any
     parent re-render that did not change the URL. */
  const query = useSearchParams().toString();

  useEffect(() => {
    /* Shares GA's rule so the two properties measure the same shop: staff
       looking at their own orders are not customers, and counting them would
       inflate exactly the audiences these events exist to build. */
    if (!isTrackablePath(pathname)) return;

    pixelPageView();
  }, [pathname, query]);

  return null;
}
