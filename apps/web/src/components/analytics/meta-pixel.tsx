"use client";

import Script from "next/script";
import { Suspense, useEffect, useState } from "react";

import { MetaPixelPageView } from "./meta-pixel-page-view";

/**
 * The Meta Pixel tag, plus the tracker that feeds it.
 *
 * A client component that asks the server for the pixel ID, rather than a
 * server component rendering it straight in — the same reason spelled out in
 * `google-analytics.tsx` and in app/api/analytics-config/route.ts: these pages
 * are prerendered, so a `process.env` read during render happens at build
 * time, and a deploy that can only set variables on a running container would
 * never get a value in. Fetching moves the read to request time.
 *
 * Renders nothing when META_PIXEL is unset, so a dev run or a preview deploy
 * neither loads Meta's script nor pollutes the pixel with traffic that is not
 * customers.
 */
export function MetaPixel() {
  const [pixelId, setPixelId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/analytics-config")
      .then((response) => (response.ok ? response.json() : null))
      .then((config) => {
        if (!cancelled && typeof config?.pixelId === "string") {
          setPixelId(config.pixelId);
        }
      })
      /* Tracking failing must never surface to a shopper, and must never
         reject unhandled. */
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  if (!pixelId) return null;

  return (
    <>
      {/* Meta's loader, with its trailing `fbq('track', 'PageView')` removed
          on purpose. This is an App Router SPA: the snippet's PageView fires
          on the document load only, so leaving it in would count the landing
          view twice — once here, once from the tracker below — and still miss
          every client-side navigation. `MetaPixelPageView` owns all of them.

          `afterInteractive` matches the GA tag next door: still runs on the
          first load, so no view is lost, but held until after hydration so it
          never competes with the shop's own JS. */}
      <Script id="meta-pixel" strategy="afterInteractive">
        {`!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window,document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${pixelId}');`}
      </Script>

      {/* Mounted only once the ID has arrived, so the tracker's first send
          cannot happen before there is a pixel initialised to receive it.

          `useSearchParams()` inside forces the nearest Suspense boundary to
          render on the client. Without one here that boundary is the whole
          page, which would opt every route out of static prerendering — a
          tracking tag must not cost the shop its static catalog. */}
      <Suspense fallback={null}>
        <MetaPixelPageView />
      </Suspense>

      {/* The no-JS fallback from Meta's snippet. Reaches a visitor whose
          browser ran no script at all, which is the one case the tag above
          cannot cover. */}
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          alt=""
          src={`https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1`}
        />
      </noscript>
    </>
  );
}
