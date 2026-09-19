import type { AdminRole } from "@sakura/contracts";

/** localStorage key: "have I signed in on this browser". See lib/api/admin.ts's docs. */
export const ADMIN_AUTHED_KEY = "sakura-admin-authed";

/**
 * localStorage key: the role this browser last signed in as.
 *
 * A hint for drawing the right rail on the first paint, exactly as the flag
 * above is a hint for whether to draw one at all. It decides nothing: the API
 * refuses a packer everywhere outside the packing table whatever this says,
 * and `/admin/auth/me` corrects it on every page load.
 */
export const ADMIN_ROLE_KEY = "sakura-admin-role";

/**
 * The panel paths a FULFILLMENT account works in, relative to `/{locale}/admin`.
 *
 * Processing is the packer's home; an order's own page is where Processing
 * links to; Stock is read-only for them. Everything else in the panel is
 * behind a route the API will refuse, so the shell sends them home rather
 * than rendering a screen of errors.
 */
export const FULFILLMENT_HOME = "/accepted-orders";

export function isPathAllowedForRole(role: AdminRole | null, path: string): boolean {
  if (role !== "FULFILLMENT") return true;

  return (
    path === FULFILLMENT_HOME ||
    path.startsWith(`${FULFILLMENT_HOME}/`) ||
    path === "/stock" ||
    // One order's page, but not the Orders triage list above it.
    /^\/orders\/[^/]+$/.test(path)
  );
}

/** Where signing in lands, by role. */
export function homePathFor(role: AdminRole | null): string {
  return role === "FULFILLMENT" ? FULFILLMENT_HOME : "";
}
