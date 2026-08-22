"use client";

import { useEffect } from "react";

/**
 * Keeps the admin panel on the dark palette regardless of the storefront's
 * light-default/system theme, and releases it on the way out.
 *
 * `theme.css` already ships a complete `:root[data-theme="dark"]` palette —
 * nothing sets the attribute today. This is the client-side half of that:
 * it runs after hydration, which is why `admin/layout.tsx` also renders a
 * blocking inline script that sets the same attribute before paint, so the
 * storefront's light theme never flashes on the way into the panel.
 */
export function AdminThemeLock() {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute("data-theme");
    root.setAttribute("data-theme", "dark");

    return () => {
      if (previous === null) root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", previous);
    };
  }, []);

  return null;
}
