"use client";

import { useEffect } from "react";

import { applyAdminTheme, readAdminTheme } from "@/lib/admin-theme";

/**
 * Puts the panel in its own palette on the way in, and takes it back off on
 * the way out.
 *
 * Two attributes do the work. `data-admin` selects the admin token layer in
 * `admin-theme.css` — the warm paper ground, the stronger rules, the deepened
 * clay, the rail. `data-theme` picks light or dark within it, from the
 * device-local preference.
 *
 * This is the client-side half. `admin/layout.tsx` renders a blocking script
 * that sets the same two attributes before the first paint, because a panel
 * that arrives in the storefront's palette and corrects itself after
 * hydration is a flash on every single navigation into /admin.
 *
 * The cleanup matters as much as the setup: the storefront is a different
 * world with a different default, and leaving `data-theme="dark"` on <html>
 * after signing out would hand the shop a night palette nobody chose.
 */
export function AdminThemeLock() {
  useEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.getAttribute("data-theme");

    root.setAttribute("data-admin", "");
    applyAdminTheme(readAdminTheme());

    return () => {
      root.removeAttribute("data-admin");
      if (previousTheme === null) root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", previousTheme);
    };
  }, []);

  return null;
}
