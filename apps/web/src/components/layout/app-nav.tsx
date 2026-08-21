"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { CountBadge } from "@/components/ui";
import { useCartCount } from "@/hooks/use-cart";

import { FloatingNav, type FloatingNavItem } from "./floating-nav";
import { LanguageSwitcher } from "./language-switcher";

/**
 * FloatingNav with this app's items, its locale prefix and the store wired in.
 *
 * FloatingNav itself stays unaware of Redux, i18n and the route table — it
 * takes an items array, which is what lets it be rendered in the playground or
 * a test with no provider. This wrapper is the only place the four are joined,
 * and every page uses it so the bar is identical across the app.
 */
export function AppNav({ brandHref }: { brandHref?: string } = {}) {
  const { locale } = useParams<{ locale: string }>();
  const count = useCartCount();

  /* Principle 04: motion only as confirmation. A book was just added — not
     the persisted count settling in on load, which is why the bump only
     fires on an increase after the first render, never on mount. */
  const previousCount = useRef(count);
  const [bump, setBump] = useState(false);

  useEffect(() => {
    if (count > previousCount.current) {
      setBump(true);
      const id = setTimeout(() => setBump(false), 240);
      previousCount.current = count;
      return () => clearTimeout(id);
    }
    previousCount.current = count;
  }, [count]);

  const items = useMemo<FloatingNavItem[]>(() => {
    const base = `/${locale ?? "en"}`;

    return [
      { kind: "link", label: "Home", href: base },
      { kind: "link", label: "Books", href: `${base}/catalog` },
      { kind: "link", label: "Track Order", href: `${base}/orders` },
      /* Mobile only. Above the tablet floor the cart keeps its place in the
         right-hand actions, where the wordmark and the language switcher give
         it a side of the bar to sit on. Below it, there is no room for a
         second cluster — so rather than a lone glyph pushed against the edge,
         the cart joins the items and behaves like one: the pill tracks it, and
         /cart lights up the way every other route does. */
      {
        kind: "link",
        label: "Cart",
        href: `${base}/cart`,
        className: "sm:hidden",
        content: (
          <>
            <span>Cart</span>
            <CountBadge count={count} className={bump ? "animate-bump" : undefined} />
          </>
        ),
      },
    ];
  }, [locale, count, bump]);

  return (
    <FloatingNav
      items={items}
      brandHref={brandHref ?? `/${locale ?? "en"}`}
      actions={
        <>
          {/* Locale is a settings-shaped choice, not navigation — it stands
              down at mobile, where the width belongs to the nav items. */}
          <span className="hidden sm:block">
            <LanguageSwitcher />
          </span>
          {/* Tablet and up only — below that the cart is a nav item instead,
              so this would be the same destination twice in one bar. */}
          <Link
            href={`/${locale ?? "en"}/cart`}
            className="text-13.5 text-ink rounded-pill focus-visible:rounded-pill hidden items-center gap-2 px-2 py-2 sm:flex sm:px-3"
          >
            <span>Cart</span>
            <CountBadge count={count} className={bump ? "animate-bump" : undefined} />
          </Link>
        </>
      }
    />
  );
}
