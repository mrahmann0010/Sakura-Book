"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/* This Next.js version's <Link> defaults to preserving scroll position on
   navigation (like browser back/forward) instead of resetting it, so route
   changes need to scroll to top explicitly. */
export function ScrollToTop() {
  const pathname = usePathname();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
