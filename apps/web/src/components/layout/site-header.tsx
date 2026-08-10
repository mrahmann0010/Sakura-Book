"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { CountBadge, Wordmark } from "@/components/ui";
import { navLink } from "@/lib/variants";
import { cn } from "@/lib/utils";

export type NavItem = {
  href: string;
  label: string;
};

export type SiteHeaderProps = {
  /** Wordmark text and where it links. */
  brand?: ReactNode;
  brandHref?: string;
  /** Primary nav. Omit on transactional pages, which show a step instead. */
  nav?: NavItem[];
  /** The href of the active nav item — active is ink at 600, never clay. */
  activeHref?: string;
  /** Cart count. Zero renders no badge, as the "empty cart" header shows. */
  cartCount?: number;
  cartHref?: string;
  searchHref?: string;
  /**
   * Replaces nav and actions entirely — "Step 2 of 3 · Details and payment".
   * Cart, checkout and confirmation all use this instead of navigation.
   */
  step?: ReactNode;
  /** Extra actions to the right of the cart. */
  actions?: ReactNode;
  className?: string;
};

/**
 * On scroll the header gains a single ink hairline instead of a shadow —
 * §7. Sticky, cream, one hairline. Nothing else changes.
 */
export function SiteHeader({
  brand = "Marginalia",
  brandHref = "/",
  nav,
  activeHref,
  cartCount = 0,
  cartHref = "/cart",
  searchHref,
  step,
  actions,
  className,
}: SiteHeaderProps) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const hasNav = Boolean(nav?.length) && !step;

  return (
    <header
      className={cn(
        "bg-page/95 sticky top-0 z-40 border-b backdrop-blur-[2px]",
        "transition-colors duration-150",
        scrolled ? "border-ink" : "border-rule",
        className,
      )}
    >
      <div className="shell flex items-center justify-between gap-8 py-5 sm:py-6">
        <Link href={brandHref} className="shrink-0">
          <Wordmark>{brand}</Wordmark>
        </Link>

        {hasNav ? (
          <nav aria-label="Primary" className="hidden gap-8 lg:flex">
            {nav?.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={item.href === activeHref ? "page" : undefined}
                className={navLink({ active: item.href === activeHref })}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        ) : null}

        {step ? (
          <p className="text-13.5 text-secondary">{step}</p>
        ) : (
          <div className="flex items-center gap-5">
            {searchHref ? (
              <Link href={searchHref} className={cn(navLink(), "hidden sm:inline")}>
                Search
              </Link>
            ) : null}

            <Link href={cartHref} className="text-13.5 text-ink flex items-center gap-2">
              Cart
              <CountBadge count={cartCount} />
            </Link>

            {actions}

            {hasNav ? (
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-expanded={menuOpen}
                aria-controls="site-header-menu"
                className={cn(navLink(), "lg:hidden")}
              >
                {menuOpen ? "Close" : "Menu"}
              </button>
            ) : null}
          </div>
        )}
      </div>

      {menuOpen && hasNav ? (
        <div id="site-header-menu" className="hairline lg:hidden">
          <nav aria-label="Primary, condensed" className="shell flex flex-col py-2">
            {nav?.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className={cn(
                  navLink({ active: item.href === activeHref }),
                  "border-rule border-b py-3.5 last:border-0",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      ) : null}
    </header>
  );
}

/** "Step 2 of 3 · Details and payment". Pass into SiteHeader's `step` slot. */
export function StepIndicator({
  step,
  total,
  label,
}: {
  step: number;
  total: number;
  label: ReactNode;
}) {
  return (
    <span aria-label={`Step ${step} of ${total}: ${String(label)}`}>
      Step {step} of {total} · {label}
    </span>
  );
}

/** Books · Fiction · The Hearing Trumpet. Last crumb is the current page. */
export function Breadcrumbs({
  items,
  className,
}: {
  items: { href?: string; label: string }[];
  className?: string;
}) {
  return (
    <nav aria-label="Breadcrumb" className={cn("text-caption text-secondary", className)}>
      <ol className="flex flex-wrap items-center gap-2">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;

          return (
            <li key={item.label} className="flex items-center gap-2">
              {item.href && !isLast ? (
                <Link href={item.href} className="hover:text-clay">
                  {item.label}
                </Link>
              ) : (
                <span
                  className={isLast ? "text-ink" : undefined}
                  aria-current={isLast ? "page" : undefined}
                >
                  {item.label}
                </span>
              )}
              {!isLast ? <span aria-hidden>·</span> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
