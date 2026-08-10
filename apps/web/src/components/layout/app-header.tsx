"use client";

import { useCartCount } from "@/hooks/use-cart";

import { SiteHeader, type SiteHeaderProps } from "./site-header";

/**
 * SiteHeader with the cart count wired to the store.
 *
 * SiteHeader itself stays unaware of Redux — it takes a number, which is what
 * lets it be rendered in a reference sheet or a test with no provider. This
 * thin client wrapper is the only place the two are joined, and every page uses
 * it so the badge is consistent across the app.
 */
export function AppHeader(props: Omit<SiteHeaderProps, "cartCount">) {
  const count = useCartCount();
  return <SiteHeader cartCount={count} {...props} />;
}
