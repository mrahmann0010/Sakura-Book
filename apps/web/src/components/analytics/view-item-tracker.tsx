"use client";

import { useEffect, useRef } from "react";

import { trackViewItem } from "@/lib/analytics";

/**
 * The GA4 `view_item` event for a book's detail page.
 *
 * A component rather than a call inside the page because that page is a server
 * component: the event has to be sent from the browser, and this is the
 * smallest island that can do it without making the whole detail view client-
 * side. It renders nothing.
 */
export function ViewItemTracker({
  id,
  title,
  priceCents,
}: {
  id: string;
  title: string;
  /** Minor units, as everywhere else in the app. */
  priceCents: number;
}) {
  /* Keyed on the book, not a bare "has run" flag: a shopper going from one
     book to the next stays within this route, so React may reuse the mounted
     component and a boolean would swallow every view after the first. */
  const reported = useRef<string | null>(null);

  useEffect(() => {
    if (reported.current === id) return;
    reported.current = id;
    trackViewItem({ id, title, priceCents });
  }, [id, title, priceCents]);

  return null;
}
