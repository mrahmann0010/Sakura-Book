"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { contentGroupFor, isTrackablePath, trackPageView } from "@/lib/analytics";

/**
 * Sends one GA4 page_view per route — the first load included, because
 * `google-analytics.tsx` configures the tag with `send_page_view: false`.
 *
 * Watches the query string as well as the path: `/catalog?q=n5` and
 * `/catalog?page=2` are different views of the shelf to a visitor, and the
 * catalog reaches them without touching the pathname.
 */
export function PageViewTracker() {
  const pathname = usePathname();
  /* Read as a string, not as the object: `useSearchParams()` returns a fresh
     identity on every render, so depending on it directly would re-send a
     page_view on any parent re-render that did not change the URL at all. */
  const query = useSearchParams().toString();

  useEffect(() => {
    if (!isTrackablePath(pathname)) return;

    /* Next applies the route's `generateMetadata` title in a commit of its
       own, after this effect would otherwise run — send immediately and every
       view is filed under the *previous* page's title. A macrotask is the
       cheapest way to land after that commit; the cleanup covers a visitor who
       navigates again inside the same tick. */
    const timer = window.setTimeout(() => {
      trackPageView({
        title: document.title,
        location: window.location.href,
        contentGroup: contentGroupFor(pathname),
      });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [pathname, query]);

  return null;
}
