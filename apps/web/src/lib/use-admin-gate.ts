"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import { adminMe } from "@/lib/api/admin";
import { ADMIN_AUTHED_KEY } from "@/lib/admin-auth";

/**
 * Whether the panel may render.
 *
 * - `allowed` — this browser has signed in before, so the panel renders and
 *   its screens fetch. Provisional: `GET /admin/auth/me` may still be in
 *   flight beside them.
 * - `denied` — no local sign-in, or `/me` came back rejecting the session, or
 *   this is the server/hydration render where localStorage cannot be read yet.
 *   In the first two cases a redirect to login is already on its way.
 */
export type AdminGateStatus = "allowed" | "denied";

/**
 * The local "this browser signed in" flag, read as an external store rather
 * than in an effect.
 *
 * The point is the third argument to `useSyncExternalStore`: the panel's pages
 * are prerendered, so reading localStorage while rendering would be a
 * hydration mismatch. A distinct server snapshot is the sanctioned way to say
 * "false on the server, the real value on the client" — and it lands on the
 * first client render, so the screen below mounts and fetches without waiting
 * a render for an effect to tell it that it may.
 *
 * Nothing mutates the flag while the panel is mounted (signing out navigates
 * away), so there is nothing to subscribe to.
 */
function subscribe(): () => void {
  return () => {};
}

function readFlag(): boolean {
  return window.localStorage.getItem(ADMIN_AUTHED_KEY) !== null;
}

function readFlagOnServer(): boolean {
  return false;
}

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
 * The `/me` check runs *beside* the screen rather than in front of it. It used
 * to gate rendering, which made every admin screen cost two serial round
 * trips: `/me`, and only then the data. It buys nothing at that price — the
 * screen's own requests carry the same cookies and are judged by the same
 * server, `adminFetch` already answers a 401 by refreshing and retrying, and a
 * session that is genuinely dead ends at the same redirect below, one round
 * trip later than it used to and with nothing but a spinner lost.
 *
 * What the local flag is still trusted for, synchronously, is the difference
 * between "signed in, prove it" and "never signed in here" — a browser with no
 * flag renders no panel at all, so nobody watches a screen paint its empty
 * state on the way to the login form.
 */
export function useAdminGate(): AdminGateStatus {
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();
  const signedInHere = useSyncExternalStore(subscribe, readFlag, readFlagOnServer);

  // Set only by a `/me` that came back rejecting the session. It stops the
  // screen rendering stale data during the frames between that answer and the
  // redirect actually landing.
  const [rejected, setRejected] = useState(false);

  useEffect(() => {
    const login = `/${locale}/admin/login`;

    if (!readFlag()) {
      router.replace(login);
      return;
    }

    let cancelled = false;

    adminMe().catch(() => {
      if (cancelled) return;
      window.localStorage.removeItem(ADMIN_AUTHED_KEY);
      setRejected(true);
      router.replace(login);
    });

    return () => {
      cancelled = true;
    };
    // Once, on mount. `router` and `locale` are stable for the life of the
    // page and re-running the check on either would re-hit /admin/auth/me.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return signedInHere && !rejected ? "allowed" : "denied";
}
