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
    "/((?!api|_next/static|_next/image|favicon.ico|icon.svg|robots.txt|sitemap.xml).*)",
  ],
};

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

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
