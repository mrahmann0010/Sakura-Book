import type { ReactNode } from "react";

import { AdminShell } from "@/components/admin/admin-shell";

/**
 * Everything in the panel except sign-in.
 *
 * A route group, so the URLs are unchanged — /admin, /admin/orders and the
 * rest are exactly where they were. What the group buys is a layout that
 * covers every authenticated screen but *not* /admin/login, which has to
 * render without a session.
 *
 * The shell and the gate live here rather than in each page because a layout
 * persists across navigations between its children: the sidebar stays mounted,
 * the session check runs once per full page load instead of once per page, and
 * a click between admin screens swaps only the main content — no blank
 * "Checking session…" frame in between.
 *
 * A server component; `AdminShell` is the client boundary.
 */
export default function AdminPanelLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
