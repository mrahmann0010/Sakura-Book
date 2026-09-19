"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { CloseIcon, MenuIcon } from "@/components/admin/icons";
import { AdminScreenSkeleton } from "@/components/admin/skeletons";
import { AdminRailThemeSwitch } from "@/components/admin/theme-control";
import type { AdminRole } from "@sakura/contracts";

import { adminLogout, adminRefreshSession } from "@/lib/api/admin";
import {
  ADMIN_AUTHED_KEY,
  ADMIN_ROLE_KEY,
  FULFILLMENT_HOME,
  isPathAllowedForRole,
} from "@/lib/admin-auth";
import { AdminRoleContext } from "@/lib/admin-role";
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
 * The rail, in clusters separated by space alone.
 *
 * The headings are gone. They were eyebrows — 10px uppercase muted labels —
 * and an eyebrow over a single link is more chrome than the link it
 * introduces. Six of them over ten entries meant a third of the rail was
 * furniture explaining the rest.
 *
 * Space can only carry the grouping if the groups are big enough to read as
 * groups, which the old ones were not: Catalog, Inventory, Waitlist and
 * Feedback held one entry each, so deleting their headings would have left
 * four lone links adrift between generous gaps that no longer explained
 * themselves. So the clusters were merged into a 1 / 3 / 3 / 3 cadence, and
 * the gap between them widened to carry the separation the labels used to.
 *
 *   Dashboard                    — where you land
 *   Orders · Processing · Revenue — one order's life, in the order it happens
 *   Books · Stock · Waitlist      — the shelf: what is on it, how many, who is waiting
 *   Reviews · SMS · Settings      — everything else, ending in configuration
 *
 * Books and Stock sit together now, and the old Inventory heading's reasoning
 * survives the merge intact: they are still separate *screens* because a title
 * is edited a handful of times in its life while its stock count changes every
 * restock morning, and correcting a count should not mean opening a form full
 * of fields you had no intention of touching. Waitlist joins them because
 * Stock already reads it — a copy promised to someone waiting is not a fact
 * about the title, which is exactly why it was never filed under Catalog.
 */
const NAV_CLUSTERS = [
  [{ href: "", label: "Dashboard" }],
  [
    { href: "/orders", label: "Orders" },
    // Its own entry, not a tab inside Orders: the triage queue and the packing
    // list are worked by different people at different points in the week, and
    // the one that filters by destination division only makes sense after the
    // accept decision.
    //
    // Named for the work, matching its first tab — see that screen's header
    // comment. The route is still /accepted-orders: it is a URL people have
    // bookmarked, and renaming it would break those to no one's benefit.
    { href: "/accepted-orders", label: "Processing" },
    // Named Revenue, not Payments, and that is the whole point of the name.
    // The shop has real payment *work* — verifying receipts, reverting a
    // confirmation — and all of it lives on the order detail page. A tab
    // called Payments here promised that queue and delivered a chart. It also
    // collided with Settings → Payments, which edits wallet numbers; placement
    // alone could not keep those apart, because nothing about placement
    // survives someone saying "it's in Payments".
    { href: "/revenue", label: "Revenue" },
  ],
  [
    { href: "/books", label: "Books" },
    { href: "/stock", label: "Stock" },
    { href: "/waitlist", label: "Waitlist" },
    /* Invite Waitlist — taken out of the rail, not deleted.
     *
     * The screen and its API are untouched and still work; only the way in is
     * gone, so /admin/waitlist/invite-batch still answers to anyone who types
     * it or has it bookmarked. Restoring it is uncommenting this line.
     *
     * What it was for: the narrower "first 20 sign-ups, send them the link"
     * question a restock morning asks, as against the Waitlist page above,
     * which filters and pages through everyone.
     */
    // { href: "/waitlist/invite-batch", label: "Invite Waitlist" },
  ],
  [
    { href: "/reviews", label: "Reviews" },
    { href: "/sms", label: "Send SMS" },
    // Last, and one entry rather than four: payments, shipping, the reopening
    // date, and the notify page's book list are all configuration, edited a
    // few times a month. As separate entries they gave forms the same weight
    // as Orders, which is opened many times a day. They are tabs inside the
    // page now — see `settings-shell.tsx`.
    { href: "/settings", label: "Shop Settings" },
  ],
] as const;

type NavItem = { href: string; label: string };

/**
 * The packing table's rail: the queue it works and the shelf it reads.
 *
 * One cluster of two rather than the owner's rail with entries removed —
 * filtering the four clusters would leave Stock alone in a gap sized for a
 * group, which reads as a mistake rather than as a smaller desk.
 */
const FULFILLMENT_NAV: readonly (readonly NavItem[])[] = [
  [
    { href: FULFILLMENT_HOME, label: "Processing" },
    { href: "/stock", label: "Stock" },
  ],
];

function navFor(role: AdminRole | null): readonly (readonly NavItem[])[] {
  return role === "FULFILLMENT" ? FULFILLMENT_NAV : NAV_CLUSTERS;
}

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
  const { status, role } = useAdminGate();
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

  const base = `/${locale}/admin`;

  /**
   * A packer on a page outside the packing table — the dashboard they land on
   * from an old bookmark, or a URL typed by hand — is sent to Processing
   * instead of being shown a screen whose every request the API refuses.
   * `children` are held back meanwhile, so those requests are never made.
   */
  const pathAllowed = isPathAllowedForRole(role, pathname.slice(base.length) || "/");

  useEffect(() => {
    if (status === "allowed" && !pathAllowed) router.replace(`${base}${FULFILLMENT_HOME}`);
  }, [status, pathAllowed, base, router]);

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
  const gated = status !== "allowed" || !pathAllowed;

  async function signOut() {
    await adminLogout().catch(() => {
      // Sign-out clears the local session either way — see adminLogout's own
      // docs on why a stale/unknown token on the server is not an error here.
    });
    window.localStorage.removeItem(ADMIN_AUTHED_KEY);
    window.localStorage.removeItem(ADMIN_ROLE_KEY);
    router.push(`${base}/login`);
  }

  /* The "Admin" line under the wordmark is gone for the same reason the group
     headings are: it was a 10px uppercase eyebrow, and the dark rail, the
     locked theme and the URL all say where you are more plainly than a caption
     does. What is left is the shop's name, at full weight. */
  const wordmark = (
    <div className="px-5 py-6">
      <p className="text-h4 text-rail-ink font-serif leading-none">Nihonova</p>
    </div>
  );

  /* gap-7 between clusters against gap-0.5 within them: a 14:1 step, which is
     what it takes for proximity alone to do the grouping a label used to
     announce. The old gap-5 was tuned to sit under a heading, and reads as one
     long list without one. */
  const nav = (
    <nav aria-label="Admin sections" className="flex flex-1 flex-col gap-7 overflow-y-auto px-3">
      {/* A list per cluster, not a div: with the headings gone the grouping is
          carried by space, which a screen reader cannot see. Four lists of
          "3 items" restore the same structure without putting a label back on
          screen. */}
      {navFor(role).map((cluster) => (
        <ul key={cluster[0].href} className="flex flex-col gap-0.5">
          {cluster.map((item) => {
            const href = `${base}${item.href}`;
            const active = item.href === "" ? pathname === base : pathname.startsWith(href);

            return (
              <li key={item.href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-control text-13.5 block px-3 py-2.5 transition-colors ${
                    active
                      ? "bg-rail-active text-rail-ink font-medium"
                      : "text-rail-secondary hover:bg-rail-hover hover:text-rail-ink"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
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
        <p className="text-h4 text-rail-ink font-serif leading-none">Nihonova</p>
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

      {/* Persistent sidebar at `lg` and up.
       *
       * `lg:sticky lg:top-0 lg:h-screen` is what keeps it on screen, and the
       * height is the load-bearing part. Without it the aside had no height of
       * its own: the row above is `min-h-screen`, flex stretches its children,
       * and so the rail grew to match whatever the page beside it was. On a
       * long orders table that made the rail thousands of pixels tall, and
       * `mt-auto` duly pinned Appearance and Sign out to the bottom of the
       * *document* — so reaching them meant scrolling the entire table.
       *
       * It also switches the nav's own `overflow-y-auto` on, which until now
       * could never fire for the same reason: an element that grows to fit its
       * content never overflows. Now the rail is exactly one viewport, the
       * links scroll inside it when a short window cannot hold ten of them,
       * and the footer stays where it is.
       */}
      <aside
        data-rail
        className="bg-rail border-rail-rule hidden w-60 shrink-0 flex-col border-r lg:sticky lg:top-0 lg:flex lg:h-screen"
      >
        {rail}
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
        <AdminRoleContext.Provider value={role}>
          {gated ? <AdminScreenSkeleton /> : children}
        </AdminRoleContext.Provider>
      </main>
    </div>
  );
}
