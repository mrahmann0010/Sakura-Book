"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { adminLogout, adminRefreshSession } from "@/lib/api/admin";
import { ADMIN_AUTHED_KEY } from "@/lib/admin-auth";

/**
 * Well under the 15-minute access token life (`ADMIN_ACCESS_TOKEN_TTL`), so a
 * click never has to eat a failed request first — `adminFetch`'s reactive
 * refresh-and-retry is the real safety net (it also covers a laptop that
 * slept through this timer); this just keeps the common case silent.
 */
const SESSION_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

const NAV = [
  { href: "", label: "Dashboard" },
  { href: "/orders", label: "Orders" },
  // Its own entry directly under Orders, not a tab inside it: the triage queue
  // and the dispatch list are worked by different people at different points in
  // the week, and the one that filters by destination division only makes sense
  // after the accept decision.
  { href: "/accepted-orders", label: "Accepted Orders" },
  // Under the two order screens rather than beside Payment Settings: this is
  // what the accepted orders above it added up to, read by whoever is
  // reconciling the week — not a form for editing wallet numbers.
  { href: "/payments", label: "Payments" },
  { href: "/books", label: "Books" },
  { href: "/waitlist", label: "Waitlist" },
  // Directly under Waitlist rather than with the other settings: the reopening
  // date is the answer to the question every name on that list is waiting for,
  // and staff reach for it while working the list, not while editing payment
  // details.
  { href: "/settings/restock", label: "Reopening Date" },
  // Next to the reopening date for the same reason it sits here: both are
  // edited while working the waitlist — one answers "when", the other "which
  // books are we even collecting names for".
  { href: "/settings/notify-books", label: "Notify Page Books" },
  { href: "/settings/payments", label: "Payment Settings" },
  { href: "/settings/shipping", label: "Shipping Settings" },
] as const;

/**
 * The chrome every authenticated admin page renders inside: a persistent
 * sidebar, a sign-out control, and the dark-themed surface `theme-lock.tsx`
 * activates for the whole `/admin` segment.
 *
 * Takes `checking` as a prop rather than calling `useAdminGate()` itself —
 * every page already calls that hook to decide whether *it* is safe to fetch,
 * and calling it a second time here would mean two `/admin/auth/me` requests
 * per page load for no benefit. This component only owns the chrome.
 */
export function AdminShell({ children, checking }: { children: ReactNode; checking: boolean }) {
  const { locale } = useParams<{ locale: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);

  // Close the mobile drawer whenever the route changes — otherwise it stays
  // open over the new page after tapping a nav link. Adjusted during render
  // rather than in an effect (React's documented pattern for resetting state
  // on a prop change): an effect would close the drawer one paint after the
  // new page was already visible underneath it.
  const [drawerPathname, setDrawerPathname] = useState(pathname);
  if (pathname !== drawerPathname) {
    setDrawerPathname(pathname);
    setNavOpen(false);
  }

  // Keep the session ahead of the access token's expiry while a page sits
  // open and idle — signing out from under someone mid-task is the failure
  // this exists to prevent. Not started until the gate clears, and it stops
  // itself on unmount; a failed tick is silently left for the next one, or
  // for the reactive retry in `adminFetch`, to sort out.
  useEffect(() => {
    if (checking) return;

    const id = setInterval(() => {
      void adminRefreshSession();
    }, SESSION_REFRESH_INTERVAL_MS);

    return () => clearInterval(id);
  }, [checking]);

  if (checking) {
    return (
      <div className="bg-page text-secondary flex min-h-screen items-center justify-center">
        Checking session…
      </div>
    );
  }

  const base = `/${locale}/admin`;

  async function signOut() {
    await adminLogout().catch(() => {
      // Sign-out clears the local session either way — see adminLogout's own
      // docs on why a stale/unknown token on the server is not an error here.
    });
    window.localStorage.removeItem(ADMIN_AUTHED_KEY);
    router.push(`${base}/login`);
  }

  const nav = (
    <nav className="flex flex-col gap-1 px-3">
      {NAV.map((item) => {
        const href = `${base}${item.href}`;
        const active = item.href === "" ? pathname === base : pathname.startsWith(href);

        return (
          <Link
            key={item.href}
            href={href}
            className={`rounded-control text-13.5 px-3 py-2.5 transition-colors ${
              active ? "bg-tint text-ink" : "text-secondary hover:bg-tint hover:text-ink"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  const signOutButton = (
    <button
      type="button"
      onClick={() => void signOut()}
      className="rounded-control border-rule text-13.5 text-secondary hover:text-ink w-full border px-3 py-2.5 text-left transition-colors"
    >
      Sign out
    </button>
  );

  return (
    <div className="bg-page text-body flex min-h-screen flex-col lg:flex-row">
      {/* Mobile top bar — replaces the sidebar header below `lg`. */}
      <header className="border-rule bg-surface flex items-center justify-between border-b px-4 py-3 lg:hidden">
        <div>
          <p className="text-h4 text-ink font-serif">Nihonova</p>
          <p className="text-caption tracking-eyebrow text-muted uppercase">Admin</p>
        </div>
        <button
          type="button"
          onClick={() => setNavOpen((open) => !open)}
          aria-expanded={navOpen}
          aria-label={navOpen ? "Close menu" : "Open menu"}
          className="rounded-control border-rule text-ink flex h-11 w-11 items-center justify-center border"
        >
          <span aria-hidden className="text-lg leading-none">
            {navOpen ? "✕" : "☰"}
          </span>
        </button>
      </header>

      {/* Mobile drawer + scrim, shown only while open below `lg`. */}
      {navOpen ? (
        <div className="lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setNavOpen(false)}
            className="fixed inset-0 z-40 bg-black/40"
          />
          <aside className="border-rule bg-surface fixed inset-y-0 left-0 z-50 flex w-64 max-w-[80vw] flex-col border-r">
            <div className="px-6 py-6">
              <p className="text-h4 text-ink font-serif">Nihonova</p>
              <p className="text-caption tracking-eyebrow text-muted mt-1 uppercase">Admin</p>
            </div>
            {nav}
            <div className="mt-auto px-3 py-6">{signOutButton}</div>
          </aside>
        </div>
      ) : null}

      {/* Persistent sidebar at `lg` and up. */}
      <aside className="border-rule bg-surface hidden w-56 shrink-0 flex-col border-r lg:flex">
        <div className="px-6 py-6">
          <p className="text-h4 text-ink font-serif">Nihonova</p>
          <p className="text-caption tracking-eyebrow text-muted mt-1 uppercase">Admin</p>
        </div>
        {nav}
        <div className="mt-auto px-3 py-6">{signOutButton}</div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">{children}</main>
    </div>
  );
}
