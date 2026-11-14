import { NextResponse, type NextRequest } from "next/server";

import { defaultLocale, locales } from "@/i18n/settings";

/**
 * Carries the resolved locale to server components that cannot receive it as a
 * param.
 *
 * `not-found.tsx` is the reason this exists: the file convention takes no
 * props, so a 404 rendered inside `app/[locale]/` has no way to read the
 * segment it is sitting under. The alternative was a client component reading
 * `useParams`, which does not server-render as a not-found boundary at all —
 * a blank page until hydration, and nothing for a crawler.
 */
export const LOCALE_HEADER = "x-locale";

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|pdfjs|favicon.ico|icon.svg|robots.txt|sitemap.xml).*)",
  ],
};

/**
 * Static assets under public/ that must never be given a locale prefix.
 *
 * `pdfjs/` is the pdf.js worker, the CJK character maps and the standard font
 * metrics (see scripts/copy-pdfjs-assets.mjs), fetched by absolute path from
 * inside the browser by the sample reader. Prefixed, they become `/bn/pdfjs/…`
 * and resolve to nothing — and the failure is quiet in exactly the wrong way:
 * the worker 404s, pdf.js gives up or falls back onto the main thread, and the
 * sample either never appears or freezes the tab, with nothing in the console
 * pointing back at this file.
 *
 * Checked here rather than left to the `matcher` above, which also names it.
 * On Next 16.3 the matcher's exclusions are not applied to public/ files at
 * runtime — `/file.svg` is redirected today despite the same list — so the
 * config alone does not hold. Both are kept: the matcher is the declaration of
 * intent and saves the invocation wherever it is honoured, and this is the
 * check that actually runs.
 */
const UNPREFIXED_PATHS = ["/pdfjs/"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (UNPREFIXED_PATHS.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const matched = locales.find(
    (locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`),
  );

  if (matched) {
    /* Forwarded as a *request* header, not a response one: this is input for
       the render, not something the browser needs. */
    const headers = new Headers(request.headers);
    headers.set(LOCALE_HEADER, matched);
    return NextResponse.next({ request: { headers } });
  }

  /* A locale-less request (a bare `/`, or any path with no `/en`, `/bn`, `/ja`
     prefix) always lands on `defaultLocale` — the shop's storefront is
     Bangladeshi and Bangla-first regardless of the visitor's browser
     language. This is only the *first* landing: the language switcher, or a
     direct `/en`/`/ja` link, still moves a visitor to another locale from
     there. */
  const url = request.nextUrl.clone();
  url.pathname = `/${defaultLocale}${pathname}`;
  return NextResponse.redirect(url);
}
