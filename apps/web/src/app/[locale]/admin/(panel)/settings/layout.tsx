import type { ReactNode } from "react";

import { AdminSettingsShell } from "@/components/admin/settings-shell";

/**
 * Wraps every /admin/settings tab in the shared chrome — the admin sidebar,
 * the gate, and the tab strip — so the pages below hold nothing but their own
 * form. A server component: `AdminSettingsShell` is the client boundary.
 */
export default function AdminSettingsLayout({ children }: { children: ReactNode }) {
  return <AdminSettingsShell>{children}</AdminSettingsShell>;
}
