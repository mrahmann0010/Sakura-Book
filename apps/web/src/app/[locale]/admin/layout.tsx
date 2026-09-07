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
 * storefront's palette from flashing for a frame on the way into the panel —
 * the same technique a `next-themes`-style no-flash script uses.
 * `AdminThemeLock` (a client component) does the same assignment after
 * hydration and, more importantly, cleans it up when navigating back out to
 * the storefront.
 *
 * Inlined as a string rather than importing from `lib/admin-theme` because it
 * has to run before any bundle does — which means the storage key and the
 * default are duplicated from `ADMIN_THEME_KEY` and `ADMIN_THEME_DEFAULT`.
 * Change either there and change it here; there is no build step tying them
 * together, and the symptom of forgetting is a one-frame flash of the wrong
 * palette, which is easy to miss and annoying to trace.
 *
 * "light" is written out for an unset or unreadable preference rather than
 * left to the OS: the panel's default is light, and a storage read that throws
 * in a locked-down browser must not land on a palette nobody picked.
 */
const NO_FLASH_SCRIPT = `(function(){var d=document.documentElement;d.setAttribute("data-admin","");var t;try{t=localStorage.getItem("sakura-admin-theme")}catch(e){}if(t!=="light"&&t!=="dark"&&t!=="system")t="light";if(t==="system")d.removeAttribute("data-theme");else d.setAttribute("data-theme",t)})();`;

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      <AdminThemeLock />
      {children}
    </>
  );
}
