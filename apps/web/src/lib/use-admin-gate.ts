"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { adminMe } from "@/lib/api/admin";
import { ADMIN_AUTHED_KEY } from "@/lib/admin-auth";

/**
 * The panel's client-side gate, in one place because there is now more than
 * one admin page and a gate that each page reimplements is a gate one page
 * eventually forgets.
 *
 * localStorage says whether this browser signed in; `GET /admin/auth/me` is
 * the actual check, since the session is an httpOnly cookie this code can
 * neither read nor forge. Still a first pass — middleware reading the cookie
 * server-side would stop the unauthenticated flash, and remains the next step.
 *
 * Returns `checking`, which every caller renders a placeholder for: without
 * it the page renders its empty state for one frame before the redirect, and
 * that frame reads as "there are no pre-orders" rather than "signing in".
 */
export function useAdminGate(): { checking: boolean } {
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    async function check() {
      if (typeof window === "undefined") return;

      if (!window.localStorage.getItem(ADMIN_AUTHED_KEY)) {
        router.replace(`/${locale}/admin/login`);
        return;
      }

      try {
        await adminMe();
        setChecking(false);
      } catch {
        window.localStorage.removeItem(ADMIN_AUTHED_KEY);
        router.replace(`/${locale}/admin/login`);
      }
    }

    void check();
    // Once, on mount. `router` and `locale` are stable for the life of the
    // page and re-running the check on either would re-hit /admin/auth/me.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { checking };
}
