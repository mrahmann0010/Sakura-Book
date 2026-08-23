"use client";

import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { adminLogout } from "@/lib/api/admin";
import { ADMIN_AUTHED_KEY } from "@/lib/admin-auth";

const NAV = [
  { href: "", label: "Dashboard" },
  { href: "/orders", label: "Orders" },
  { href: "/books", label: "Books" },
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

  return (
    <div className="bg-page text-body flex min-h-screen">
      <aside className="border-rule bg-surface flex w-56 shrink-0 flex-col border-r">
        <div className="px-6 py-6">
          <p className="text-h4 text-ink font-serif">Nihonova</p>
          <p className="text-caption tracking-eyebrow text-muted mt-1 uppercase">Admin</p>
        </div>

        <nav className="flex flex-col gap-1 px-3">
          {NAV.map((item) => {
            const href = `${base}${item.href}`;
            const active = item.href === "" ? pathname === base : pathname.startsWith(href);

            return (
              <Link
                key={item.href}
                href={href}
                className={`rounded-control text-13.5 px-3 py-2 transition-colors ${
                  active ? "bg-tint text-ink" : "text-secondary hover:bg-tint hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto px-3 py-6">
          <button
            type="button"
            onClick={() => void signOut()}
            className="rounded-control border-rule text-13.5 text-secondary hover:text-ink w-full border px-3 py-2 text-left transition-colors"
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
