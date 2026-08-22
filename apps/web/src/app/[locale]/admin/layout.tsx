import type { ReactNode } from "react";
import { AdminThemeLock } from "@/components/admin/theme-lock";

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
