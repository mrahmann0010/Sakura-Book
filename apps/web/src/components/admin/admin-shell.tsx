"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { CloseIcon, MenuIcon } from "@/components/admin/icons";
import { AdminScreenSkeleton } from "@/components/admin/skeletons";
import { AdminRailThemeSwitch } from "@/components/admin/theme-control";
import { adminLogout, adminRefreshSession } from "@/lib/api/admin";
import { ADMIN_AUTHED_KEY } from "@/lib/admin-auth";
import { useAdminGate } from "@/lib/use-admin-gate";

/**
 * Well under the one-hour access token life (`ADMIN_ACCESS_TOKEN_TTL`), so a
 * click never has to eat a failed request first — `adminFetch`'s reactive
 * refresh-and-retry is the real safety net (it also covers a laptop that
 * slept through this timer); this just keeps the common case silent.
 *
 * Not much *further* under it: every tick rotates the refresh token, and two
 * tabs ticking at once is the collision the server now forgives rather than
 * one it should be asked to forgive four times an hour.
 */
const SESSION_REFRESH_INTERVAL_MS = 45 * 60 * 1000;

/**
 * The rail, in groups.
 *
 * The order is unchanged and still the order the work happens in; the headings
 * are new. Nine flat links made the reader scan the whole list to find the one
 * they wanted, because nothing said where the order screens stopped and the
 * catalog began — and the answer was already there in the reasoning below,
 * just not on screen. A group with one item (Catalog) still earns its heading:
 * it is what makes Books visibly not another order queue.
 *
 * `label: null` is the Dashboard's group — a heading over a single entry at
 * the very top would be chrome above chrome.
 */
const NAV_GROUPS = [
  {
    label: null,
    items: [{ href: "", label: "Dashboard" }],
  },
  {
    label: "Orders",
    items: [
      { href: "/orders", label: "Orders" },
      // Its own entry directly under Orders, not a tab inside it: the triage
      // queue and the dispatch list are worked by different people at different
      // points in the week, and the one that filters by destination division
      // only makes sense after the accept decision.
      { href: "/accepted-orders", label: "Accepted Orders" },
      // Under the two order screens rather than beside Payment Settings: this
      // is what the accepted orders above it added up to, read by whoever is
      // reconciling the week — not a form for editing wallet numbers.
      { href: "/payments", label: "Payments" },
    ],
  },
  {
    label: "Catalog",
    items: [{ href: "/books", label: "Books" }],
  },
  {
    /**
     * Its own section, not a second entry under Catalog.
     *
     * Catalog is what a title *is* — cover, price, blurb, SEO — and it is
     * edited a handful of times in a book's life. Inventory is how many copies
     * exist and who they are owed to, which changes every restock morning and
     * every time somebody buys. Filing them together made the daily job a
     * visitor inside the rare one, and it dragged the whole book form along
     * with it: to correct a stock count you opened a page of fields you had no
     * intention of touching, any one of which you could change by accident.
     *
     * The split is also what the numbers say. Inventory reads the waitlist as
     * much as the catalog — a copy promised to someone waiting is not a fact
     * about the title at all — so there was never one parent it belonged
     * under.
     */
    label: "Inventory",
    items: [{ href: "/stock", label: "Stock" }],
  },
  {
    label: "Waitlist",
    items: [
      { href: "/waitlist", label: "Waitlist" },
      // Split out from the list above: that page filters and pages through
      // everyone, this one answers the narrower "first 20 sign-ups, send them
      // the link" question a restock morning actually asks.
      { href: "/waitlist/invite-batch", label: "Invite Waitlist" },
    ],
  },
  {
    label: "Shop",
    items: [
      { href: "/sms", label: "Send SMS" },
      // Last, and one entry rather than four: payments, shipping, the reopening
      // date, and the notify page's book list are all configuration, edited a
      // few times a month. As separate entries they made this list ten items
      // long and gave forms the same weight as Orders, which is opened many
      // times a day. They are tabs inside the page now — see
      // `settings-shell.tsx`.
      { href: "/settings", label: "Shop Settings" },
    ],
  },
] as const;

/**
 * The chrome every authenticated admin page renders inside: a persistent
 * sidebar, a sign-out control, and the dark-themed surface `theme-lock.tsx`
 * activates for the whole `/admin` segment.
 *
 * Rendered by the `(panel)` layout rather than by each page, which is what
 * makes it *persistent*: in the App Router a layout stays mounted across
 * navigations between its children, so a click swaps only the `<main>`
 * content. The sidebar no longer unmounts and remounts, there is no blank
 * "Checking session…" screen between admin pages, and the gate below runs once
 * per full page load instead of once per page.
 *
 * Login sits outside the group on purpose — it is the one `/admin` route that
 * must render without a session.
 *
 * The gate here does not hold the screen back. Once the local sign-in flag
 * says this browser has a session, `children` render and fetch immediately
 * while `/admin/auth/me` is still in the air beside them — see `useAdminGate`
 * for why that is safe, and for what the flag is still trusted to decide
 * synchronously.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const status = useAdminGate();
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
  // this exists to prevent. Not started until the panel is actually up, and it
  // stops itself on unmount; a failed tick is silently left for the next one,
  // or for the reactive retry in `adminFetch`, to sort out.
  useEffect(() => {
    if (status !== "allowed") return;

    const id = setInterval(() => {
      void adminRefreshSession();
    }, SESSION_REFRESH_INTERVAL_MS);

    return () => clearInterval(id);
  }, [status]);

  /**
   * `denied` covers both the hydration render, before localStorage can be
   * read, and a real rejection with a redirect already in flight.
   *
   * It swaps the main content for a skeleton rather than replacing the whole
   * screen with a sentence. The rail is chrome — it depends on nothing that is
   * still loading, so there is no reason for it to leave, and a panel that
   * keeps its frame and fills in its content reads as arriving. A page that
   * goes blank and says "Checking session…" in the middle reads as a fault,
   * even when it lasts exactly as long.
   *
   * `children` are still withheld: they must not mount and fetch until the
   * session is established.
   */
  const gated = status !== "allowed";

  const base = `/${locale}/admin`;

  async function signOut() {
    await adminLogout().catch(() => {
      // Sign-out clears the local session either way — see adminLogout's own
      // docs on why a stale/unknown token on the server is not an error here.
    });
    window.localStorage.removeItem(ADMIN_AUTHED_KEY);
    router.push(`${base}/login`);
  }

  const wordmark = (
    <div className="px-5 py-6">
      <p className="text-h4 text-rail-ink font-serif leading-none">Nihonova</p>
      <p className="text-10 tracking-label text-rail-muted mt-1.5 uppercase">Admin</p>
    </div>
  );

  const nav = (
    <nav aria-label="Admin sections" className="flex flex-1 flex-col gap-5 overflow-y-auto px-3">
      {NAV_GROUPS.map((group, index) => (
        <div key={group.label ?? `group-${index}`} className="flex flex-col gap-0.5">
          {group.label ? (
            <p className="text-10 tracking-label text-rail-muted mb-1 px-3 uppercase">
              {group.label}
            </p>
          ) : null}

          {group.items.map((item) => {
            const href = `${base}${item.href}`;
            const active = item.href === "" ? pathname === base : pathname.startsWith(href);

            return (
              <Link
                key={item.href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`rounded-control text-13.5 px-3 py-2.5 transition-colors ${
                  active
                    ? "bg-rail-active text-rail-ink font-medium"
                    : "text-rail-secondary hover:bg-rail-hover hover:text-rail-ink"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );

  const railFooter = (
    <div className="border-rail-rule mt-auto flex flex-col gap-4 border-t px-3 py-5">
      <AdminRailThemeSwitch />
      <button
        type="button"
        onClick={() => void signOut()}
        className="rounded-control border-rail-rule text-13.5 text-rail-secondary hover:bg-rail-hover hover:text-rail-ink w-full border px-3 py-2.5 text-left transition-colors"
      >
        Sign out
      </button>
    </div>
  );

  /* One composition, rendered twice — as the fixed drawer below `lg` and the
     persistent column above it. Written once so the two can never drift. */
  const rail = (
    <>
      {wordmark}
      {nav}
      {railFooter}
    </>
  );

  return (
    <div className="bg-page text-body flex min-h-screen flex-col lg:flex-row">
      {/* Mobile top bar — the rail's colour, so the chrome is one thing at
          every width rather than a dark column that becomes a light bar. */}
      <header
        data-rail
        className="bg-rail border-rail-rule flex items-center justify-between border-b px-4 py-3 lg:hidden"
      >
        <div>
          <p className="text-h4 text-rail-ink font-serif leading-none">Nihonova</p>
          <p className="text-10 tracking-label text-rail-muted mt-1 uppercase">Admin</p>
        </div>
        <button
          type="button"
          onClick={() => setNavOpen((open) => !open)}
          aria-expanded={navOpen}
          aria-label={navOpen ? "Close menu" : "Open menu"}
          className="rounded-control border-rail-rule text-rail-ink hover:bg-rail-hover flex h-11 w-11 items-center justify-center border transition-colors"
        >
          {navOpen ? <CloseIcon /> : <MenuIcon />}
        </button>
      </header>

      {/* Mobile drawer + scrim, shown only while open below `lg`. */}
      {navOpen ? (
        <div className="lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setNavOpen(false)}
            className="bg-overlay fixed inset-0 z-40"
          />
          <aside
            data-rail
            className="bg-rail border-rail-rule fixed inset-y-0 left-0 z-50 flex w-64 max-w-[80vw] flex-col border-r"
          >
            {rail}
          </aside>
        </div>
      ) : null}

      {/* Persistent sidebar at `lg` and up. */}
      <aside
        data-rail
        className="bg-rail border-rail-rule hidden w-60 shrink-0 flex-col border-r lg:flex"
      >
        {rail}
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
        {gated ? <AdminScreenSkeleton /> : children}
      </main>
    </div>
  );
}
