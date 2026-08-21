import { relations } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { auditActionEnum } from "../enums";
import { adminUsers } from "./admin-user";

/**
 * Every write an admin makes, append-only.
 *
 * This exists because of what the rest of the backend already promises. The
 * design's load-bearing property is that each column has exactly one writer
 * and that writer is provable: `order_status_history` is append-only, stock
 * only moves through a guarded UPDATE, coupon uses are consumed atomically.
 * An admin panel is a second write path into every one of those, operated by
 * a human, and without this table the property quietly stops holding — "the
 * stock is wrong" becomes unanswerable rather than a query.
 *
 * It is also the only record that survives the thing it describes. A deleted
 * coupon leaves no row to inspect; the audit entry keeps its `before` state.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    /**
     * Who. Nullable, and `set null` rather than `cascade`, because the entry
     * outlives the account: the record that someone deleted a book must not
     * disappear when that someone leaves. Accounts are normally disabled
     * rather than deleted for exactly this reason, and this is the backstop
     * for when one is deleted anyway.
     */
    actorId: uuid("actor_id").references(() => adminUsers.id, { onDelete: "set null" }),

    /**
     * The actor's email, frozen at the time of the action.
     *
     * Denormalised on purpose, and it is not the usual denormalisation for
     * speed — it is so the entry still names a person after the account behind
     * `actorId` is gone or has changed hands. The same reasoning as
     * `order_items.book_title_snapshot`: a record of what happened must not be
     * rewritten by later edits to the things it refers to.
     */
    actorEmail: text("actor_email"),

    action: auditActionEnum("action").notNull(),

    /** Table name — "books", "orders", "coupons". Free text, matched by hand. */
    entityType: text("entity_type").notNull(),

    /**
     * Nullable because not every audited action has one: a failed login has no
     * entity, and a bulk import has too many. Text rather than uuid so the
     * column can hold an order number or a slug when that is the identifier a
     * human would actually search for.
     */
    entityId: text("entity_id"),

    /**
     * The changed fields only, before and after — not whole row snapshots.
     *
     * A full copy of the row on both sides would bury the one field that moved
     * under thirty that did not, and this table is read by a person trying to
     * answer "who changed this price". `before` is null for a create, `after`
     * is null for a delete.
     */
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),

    /** Free-text reason, where the endpoint asks for one (stock adjustments). */
    note: text("note"),

    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),

    /**
     * No `updatedAt`, and no `timestamps` spread. The table is append-only;
     * a column implying an entry can be edited would contradict the only
     * property that makes an audit log worth having.
     */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // "what happened to this order" — the entity timeline, newest first.
    index("audit_log_entity_idx").on(table.entityType, table.entityId, table.createdAt.desc()),
    // "what did this person do" — the actor timeline.
    index("audit_log_actor_idx").on(table.actorId, table.createdAt.desc()),
    // The default view: everything, newest first.
    index("audit_log_created_idx").on(table.createdAt.desc()),
  ],
);

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  actor: one(adminUsers, {
    fields: [auditLog.actorId],
    references: [adminUsers.id],
  }),
}));
