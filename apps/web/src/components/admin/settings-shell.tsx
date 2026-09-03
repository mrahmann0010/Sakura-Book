"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { createContext, useContext, type ReactNode } from "react";

import { AdminShell } from "@/components/admin/admin-shell";
import { useAdminGate } from "@/lib/use-admin-gate";

/**
 * The tabs, in the order staff reach for them: money first, then fulfilment,
 * then the waitlist pair (which answer "when do we reopen" and "for which
 * titles" — two halves of the same announcement, so they sit together).
 */
const TABS = [
  { href: "/settings/payments", label: "Payments" },
  { href: "/settings/shipping", label: "Shipping" },
  { href: "/settings/restock", label: "Reopening Date" },
  { href: "/settings/notify-books", label: "Notify Page Books" },
] as const;

/**
 * How the four settings pages learn the gate's verdict.
 *
 * They each used to call `useAdminGate()` themselves, which was right when
 * each was its own top-level screen. Now the layout above them owns the gate,
 * and a page calling the hook again would mean a second `/admin/auth/me` per
 * load for an answer it is already being handed.
 */
const CheckingContext = createContext(true);

/**
 * `true` while the session is still being verified. Every settings page reads
 * this and holds off fetching until it goes false, the same contract
 * `useAdminGate` had with them before.
 */
export function useSettingsChecking(): boolean {
  return useContext(CheckingContext);
}

/**
 * One home for everything that configures the shop.
 *
 * These four forms used to be four top-level sidebar entries, which put things
 * edited a few times a month at the same weight as Orders — a screen opened
 * many times a day — and made the sidebar ten items long. They are tabs rather
 * than one long page because each owns an independent Save; stacked, it would
 * never be obvious which button wrote which fields.
 *
 * The routes are unchanged, so anything bookmarked at /admin/settings/payments
 * still lands where it did.
 */
export function AdminSettingsShell({ children }: { children: ReactNode }) {
  const { checking } = useAdminGate();
  const { locale } = useParams<{ locale: string }>();
  const pathname = usePathname();

  const base = `/${locale}/admin`;

  return (
    <AdminShell checking={checking}>
      <CheckingContext value={checking}>
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="text-h2 text-ink font-serif">Shop Settings</h1>
            <p className="text-13.5 text-secondary mt-1">
              What checkout, delivery, and the notify page are configured to do. Each tab saves on
              its own.
            </p>
          </div>

          {/* Same tab treatment as the two order screens, so the panel reads as
              one design rather than a per-screen one. Links, not buttons: each
              tab is a real route, and staff bookmark and share them. */}
          <div className="border-rule flex gap-1 overflow-x-auto border-b">
            {TABS.map((tab) => {
              const href = `${base}${tab.href}`;
              const active = pathname.startsWith(href);

              return (
                <Link
                  key={tab.href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`text-13.5 -mb-px shrink-0 border-b-2 px-4 py-2.5 transition-colors ${
                    active
                      ? "border-clay text-ink"
                      : "text-secondary hover:text-ink border-transparent"
                  }`}
                >
                  {tab.label}
                </Link>
              );
            })}
          </div>

          {children}
        </div>
      </CheckingContext>
    </AdminShell>
  );
}
