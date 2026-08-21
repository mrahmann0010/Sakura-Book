import { relations, sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { adminRoleEnum } from "../enums";
import { timestamps } from "../timestamps";
import { adminSessions } from "./admin-session";
import { auditLog } from "./audit-log";

/**
 * The staff who run the shop. A dozen rows at most, ever.
 *
 * There is no corresponding customers table and there is not going to be —
 * guest checkout is the product, and an order is authenticated by possessing
 * its number plus the email it was placed with. This table is the *only* place
 * the API keeps a credential, which is why the hardening below is concentrated
 * here rather than spread thin across a general user model.
 */
export const adminUsers = pgTable(
  "admin_users",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    /**
     * Stored lowercase and unique. The contract's schema lowercases on the way
     * in, and the check constraint below is what makes that a guarantee rather
     * than a convention — a seed script or a psql session that inserts
     * `Owner@shop.com` would otherwise create a second account that no login
     * can ever reach, because every lookup lowercases first.
     */
    email: text("email").notNull().unique(),

    name: text("name").notNull(),

    /**
     * scrypt, encoded as `scrypt$N$r$p$salt$hash` — see admin/auth/password.ts
     * for why a Node built-in rather than argon2 or bcrypt.
     *
     * The column is named for what it holds. A column called `password` is one
     * careless `SELECT *` in a log line away from being a plaintext leak, and
     * the name is the cheapest reminder that it must never be one.
     */
    passwordHash: text("password_hash").notNull(),

    role: adminRoleEnum("role").notNull().default("STAFF"),

    /**
     * Soft disable. Deliberately not a row deletion: `audit_log.actorId`
     * references this table, and deleting a departed employee would either
     * cascade away the record of what they did or fail on the constraint. A
     * disabled account keeps its history and cannot log in.
     */
    disabledAt: timestamp("disabled_at", { withTimezone: true }),

    /**
     * Consecutive failed logins, reset to zero on success. Drives the lockout
     * in AdminAuthService — see the comment there for why the counter lives on
     * the row rather than in the throttler.
     */
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),

    /** Set when the counter trips; login is refused until it passes. */
    lockedUntil: timestamp("locked_until", { withTimezone: true }),

    /** Last *successful* login. Shown in the admin user list. */
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),

    /**
     * Bumped whenever every existing session for this user must stop being
     * accepted: a password change, a role change, an explicit "sign out
     * everywhere", or a disable.
     *
     * This is what closes the access token's revocation window. Refresh tokens
     * are rows and can simply be deleted, but an access token is a signed
     * bearer credential that is valid until it expires — so it carries this
     * timestamp as a claim, and the guard rejects any token whose claim is
     * older than the column. Revocation becomes a single UPDATE, and it takes
     * effect on the very next request rather than in fifteen minutes.
     */
    sessionsValidFrom: timestamp("sessions_valid_from", { withTimezone: true })
      .notNull()
      .defaultNow(),

    ...timestamps,
  },
  (table) => [
    check("admin_users_email_lowercase", sql`${table.email} = lower(${table.email})`),
    // The login lookup, and the only query on this table that is on a request's
    // critical path. `email` is already unique — this index is that constraint's.
    index("admin_users_role_idx").on(table.role),
  ],
);

export const adminUsersRelations = relations(adminUsers, ({ many }) => ({
  sessions: many(adminSessions),
  auditEntries: many(auditLog),
}));
