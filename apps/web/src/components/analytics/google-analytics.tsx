"use client";

import Script from "next/script";
import { Suspense, useEffect, useState } from "react";

import { PageViewTracker } from "./page-view-tracker";

/**
 * The gtag.js tag, plus the tracker that feeds it (see lib/analytics.ts for why
 * the pageview is sent by hand rather than automatically).
 *
 * A client component that asks the server for the measurement ID, rather than a
 * server component that renders it straight in. The reason is deployment, and
 * it is spelled out in app/api/analytics-config/route.ts: these pages are
 * prerendered, so anything read from `process.env` while rendering them is
 * read during the build. Fetching moves that read to request time, which is
 * the only place an environment variable set on a running container exists.
 *
 * Renders nothing at all when G_ANALYTICS is unset, so a dev run or a preview
 * deploy neither loads Google's script nor pollutes the property.
 */
export function GoogleAnalytics() {
  const [measurementId, setMeasurementId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/analytics-config")
      .then((response) => (response.ok ? response.json() : null))
      .then((config) => {
        if (!cancelled && typeof config?.measurementId === "string") {
          setMeasurementId(config.measurementId);
        }
      })
      /* Analytics failing must never surface to a shopper, and must never
         reject unhandled. A shop that cannot count its visitors still sells
         books. */
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  if (!measurementId) return null;

  return (
    <>
      {/* `afterInteractive` rather than Google's bare `async`: it still runs on
          the very first load — no pageview is lost — but Next holds it until
          after hydration, so the tag never competes with the shop's own JS for
          the first interaction. `lazyOnload` would drop the views of anyone
          who leaves quickly. */}
      <Script
        id="ga-lib"
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
      />
      <Script id="ga-config" strategy="afterInteractive">
        {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
window.gtag = gtag;
gtag('js', new Date());
gtag('config', '${measurementId}', { send_page_view: false });`}
      </Script>
      {/* Mounted only once the ID has arrived, so the tracker's first send —
          the initial pageview — cannot happen before there is a tag configured
          to receive it. Everything after that is an ordinary route change.

          `useSearchParams()` inside forces the nearest Suspense boundary to
          render on the client. Without one here that boundary is the whole
          page, which would opt every route out of static prerendering — an
          analytics tag must not cost the shop its static catalog. */}
      <Suspense fallback={null}>
        <PageViewTracker />
      </Suspense>
    </>
  );
}
