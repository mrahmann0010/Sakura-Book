"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

const nav = [
  { href: "/catalog", label: "Catalog" },
  { href: "/staff-picks", label: "Staff picks" },
  { href: "/about", label: "About" },
  { href: "/orders", label: "Track order" },
];

export function SiteHeader({ cartCount = 0 }: { cartCount?: number }) {
  /* On scroll the header gains a single ink hairline instead of a shadow. */
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b bg-page/95 backdrop-blur-[2px]",
        "transition-colors duration-150",
        scrolled ? "border-ink" : "border-rule",
      )}
    >
      <div className="shell flex items-center justify-between gap-8 py-5 sm:py-6">
        <Link href="/" className="wordmark shrink-0">
          Marginalia
        </Link>

        <nav aria-label="Primary" className="hidden gap-8 lg:flex">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-13.5 text-secondary hover:text-clay"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-5">
          <Link
            href="/search"
            className="hidden text-13.5 text-secondary hover:text-clay sm:inline"
          >
            Search
          </Link>

          <Link href="/cart" className="flex items-center gap-2 text-13.5 text-ink">
            Cart
            {cartCount > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-pill bg-clay px-1.5 text-11.5 font-semibold text-surface">
                {cartCount}
              </span>
            )}
          </Link>

          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="header-menu"
            className="text-13.5 text-secondary hover:text-ink lg:hidden"
          >
            {menuOpen ? "Close" : "Menu"}
          </button>
        </div>
      </div>

      {menuOpen && (
        <div id="header-menu" className="hairline lg:hidden">
          <nav
            aria-label="Primary, condensed"
            className="shell flex flex-col py-2"
          >
            {[...nav, { href: "/search", label: "Search" }].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className="border-b border-rule py-3.5 text-13.5 text-secondary last:border-0 hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
