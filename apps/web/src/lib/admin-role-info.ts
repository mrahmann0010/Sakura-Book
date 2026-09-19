import type { AdminRole } from "@sakura/contracts";

/**
 * What each role is, in the owner's words, for Settings → User Management.
 *
 * Written against what the API actually enforces — `@Roles("ADMIN")` and
 * `@AllowFulfillment()` — so the page never promises a restriction the server
 * does not hold. When a guard changes, this is the copy to re-read.
 *
 * Ordered widest access first, which is also the order the role picker shows
 * them in: the owner reads down until they reach the least a person needs.
 */
export const ROLE_ORDER: readonly AdminRole[] = ["ADMIN", "STAFF", "FULFILLMENT"];

export type RoleInfo = {
  label: string;
  /** One line, for the role picker. */
  summary: string;
  can: readonly string[];
  cannot: readonly string[];
};

export const ROLE_INFO: Record<AdminRole, RoleInfo> = {
  ADMIN: {
    label: "Admin",
    summary: "Runs the shop. Everything, including who else can sign in.",
    can: [
      "Everything Staff can do",
      "Record refunds and withdraw a payment confirmation",
      "Change shop settings: payment numbers, shipping, SMS, waitlist",
      "Delete reviews and open or close waitlist releases",
      "Add people, change their roles, reset passwords, disable accounts",
    ],
    cannot: [
      "Change their own role or disable themselves — another admin does that",
      "Remove the last active admin",
    ],
  },
  STAFF: {
    label: "Staff",
    summary: "The daily desk: checks payments and moves orders along.",
    can: [
      "See every order, verify and confirm payments, accept or reject orders",
      "Pack, ship and deliver orders; export the courier CSV",
      "Edit books and stock counts, moderate reviews, work the waitlist",
      "Send SMS; see the dashboard and revenue",
    ],
    cannot: [
      "Record refunds or withdraw a payment confirmation",
      "Change shop settings",
      "Manage staff accounts",
    ],
  },
  FULFILLMENT: {
    label: "Packer",
    summary: "Packs paid orders and hands them to the courier.",
    can: [
      "See orders only after payment is verified, plus the last 3 days of shipped ones",
      "Mark orders Processing, then Shipped",
      "See name, phone, address, books, and the cash-on-delivery amount",
      "Download the courier CSV, leave internal notes, view stock levels",
    ],
    cannot: [
      "See payment details, transaction IDs or customer emails",
      "Confirm, cancel or refund orders",
      "Open the dashboard, revenue, books, settings or any other screen",
    ],
  },
};
