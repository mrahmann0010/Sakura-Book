import { relations } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { adminUsers } from "./admin-user";

/**
 * One row per live refresh token.
 *
 * The access token is a stateless JWT and this table is its counterweight: a
 * short-lived signed credential that costs nothing to verify, paired with a
 * long-lived opaque one that exists as a row and can therefore be destroyed.
 * That pairing is the whole session design — see admin/auth/admin-auth.service.ts.
 *
 * A session-per-row rather than a single `refreshToken` column on the user,
 * because staff sign in from the shop's desktop and from a phone, and one
 * column means logging in on the second device silently signs you out of the
 * first. It also makes "sessions" a listable thing an admin can revoke
 * individually.
 */
export const adminSessions = pgTable(
  "admin_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    adminUserId: uuid("admin_user_id")
      .notNull()
      // Sessions are worthless without their user and carry no history worth
      // keeping, so unlike audit_log this one does cascade.
      .references(() => adminUsers.id, { onDelete: "cascade" }),

    /**
     * SHA-256 of the token, never the token itself.
     *
     * A refresh token is a bearer credential: anyone holding it can mint access
     * tokens until it expires. Storing it in plaintext would mean a leaked
     * database dump — or a stray query result in a log — hands over every live
     * session, which is precisely the outcome hashing the *password* column
     * exists to prevent. Hashing it makes the row useless to a reader.
     *
     * Plain SHA-256 rather than the slow KDF used for passwords, and that is
     * not an inconsistency. A password is low-entropy and human-chosen, so it
     * must be expensive to guess; this token is 32 bytes from a CSPRNG, so
     * there is nothing to guess and a slow hash would only add latency to
     * every refresh.
     */
    tokenHash: text("token_hash").notNull().unique(),

    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    /**
     * Set when the token is spent, rather than deleting the row.
     *
     * Rotation means each refresh burns its token and issues a new one, so a
     * used token should never be presented again — and if one *is*, that is
     * evidence the token leaked and is being replayed by someone who is not
     * its owner. Keeping the spent row is what makes that detectable; deleting
     * it would make a replay indistinguishable from an expired session, which
     * is the difference between "sign in again" and "revoke this user's entire
     * session family right now". See `detectReuse` in AdminAuthService.
     */
    revokedAt: timestamp("revoked_at", { withTimezone: true }),

    /**
     * The session this one was rotated out of. Chains a device's refreshes into
     * a family, so reuse detection can revoke the whole chain rather than the
     * one row that was replayed — a thief who already rotated once holds a
     * token further down the chain, and killing only the replayed row would
     * leave them signed in.
     */
    rotatedFromId: uuid("rotated_from_id"),

    /** Recorded for the session list — "Chrome on macOS, 2 hours ago". */
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // "every live session for this user", for the session list and for the
    // bulk revoke that a password change triggers.
    index("admin_sessions_user_idx").on(table.adminUserId),
    // The cleanup job's query. Expired rows are not load-bearing once reuse
    // detection has nothing left to detect.
    index("admin_sessions_expires_idx").on(table.expiresAt),
  ],
);

export const adminSessionsRelations = relations(adminSessions, ({ one }) => ({
  user: one(adminUsers, {
    fields: [adminSessions.adminUserId],
    references: [adminUsers.id],
  }),
}));
