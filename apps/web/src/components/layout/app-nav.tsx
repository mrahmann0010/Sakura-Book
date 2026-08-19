"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ShoppingBag } from "lucide-react";

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

  const items = useMemo<FloatingNavItem[]>(() => {
    const base = `/${locale ?? "en"}`;

    return [
      { kind: "link", label: "Home", href: base },
      { kind: "link", label: "Books", href: `${base}/catalog` },
      { kind: "link", label: "Track Order", href: `${base}/orders` },
    ];
  }, [locale]);

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
          <Link
            href={`/${locale ?? "en"}/cart`}
            className="text-13.5 text-ink rounded-pill focus-visible:rounded-pill flex items-center gap-2 px-2 py-2 sm:px-3"
          >
            {/* The word gives way to the glyph at mobile. The badge cannot
                stand alone there — CountBadge renders nothing at zero, which
                would leave an empty target. */}
            <ShoppingBag aria-hidden className="size-4 sm:hidden" strokeWidth={1.5} />
            <span className="sr-only sm:not-sr-only">Cart</span>
            <CountBadge count={count} />
          </Link>
        </>
      }
    />
  );
}
