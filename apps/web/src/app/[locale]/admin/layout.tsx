import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminThemeLock } from "@/components/admin/theme-lock";

/* Defense in depth alongside robots.ts's admin disallow rule: a disallow
   rule stops a crawler from fetching the page at all, but doesn't de-index a
   URL that was already indexed before the rule existed. This is what
   actually keeps the panel out of search results. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Runs before the browser paints anything under it, which is what keeps the
 * storefront's light theme from flashing for a frame on the way into the
 * panel — the same technique a `next-themes`-style no-flash script uses.
 * `AdminThemeLock` (a client component) does the same assignment after
 * hydration and, more importantly, cleans it up when navigating back out to
 * the storefront.
 */
const NO_FLASH_SCRIPT = 'document.documentElement.setAttribute("data-theme", "dark");';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      <AdminThemeLock />
      {children}
    </>
  );
}
