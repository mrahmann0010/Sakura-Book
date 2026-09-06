import { relations, sql } from "drizzle-orm";
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { books } from "../catalog/book";
import { waitlistStatusEnum } from "../enums";
import { orders } from "../orders/order";
import { timestamps } from "../timestamps";

/**
 * "Notify me when it's back" — the catch-all for every restock/pre-order
 * waitlist, present and future.
 *
 * One table serves two shapes of signup rather than one per use case:
 *
 *   general restock waitlist   bookId is null   (today's /notify page —
 *                              no book picker, the shop-wide pause)
 *   per-book "notify me"       bookId is set    (a future sold-out book's
 *                              own waitlist button)
 *
 * `bookId` is nullable for exactly that reason, and `bookTitleSnapshot`
 * freezes the title the same way `orderItems.bookTitleSnapshot` does — a
 * book can be renamed or removed from the catalog long after someone joined
 * its waitlist, and the entry has to keep saying what they actually asked
 * for.
 */
export const waitlistEntries = pgTable(
  "waitlist_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    // Nullable: see the module doc. onDelete "set null" rather than a FK
    // that blocks book deletion — bookTitleSnapshot is what the entry means
    // once the book itself is gone.
    bookId: uuid("book_id").references(() => books.id, { onDelete: "set null" }),
    bookTitleSnapshot: text("book_title_snapshot"),

    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email").notNull(),
    customerPhone: text("customer_phone").notNull(),
    quantity: integer("quantity").notNull().default(1),

    // BCP 47 tag the entry was submitted under (en/bn/ja) — so the eventual
    // "it's back in stock" message goes out in the language the customer
    // actually reads, rather than whatever the shop's default happens to be.
    locale: text("locale").notNull(),

    // Free text rather than an enum: this table is meant to be fed from
    // more than one entry point over time (the shop-wide notify page today,
    // a per-book button later, maybe an admin bulk import), and a new source
    // should never need a migration to be recorded. "restock-notify-page" is
    // the only value in use today.
    source: text("source").notNull(),

    status: waitlistStatusEnum("status").notNull().default("PENDING"),

    // When staff actually sent the restock alert. Null until then — the
    // audit trail for "have we told this person yet".
    notifiedAt: timestamp("notified_at", { withTimezone: true }),

    // Set once the customer places the real order, so "how many waitlist
    // signups became sales" is a join instead of a guess. onDelete "set
    // null": an order being removed should not take the waitlist history
    // with it.
    convertedOrderId: uuid("converted_order_id").references(() => orders.id, {
      onDelete: "set null",
    }),

    internalNote: text("internal_note"), // staff-only: never shown to customer

    // The magic-link credential for "come place your order" — a random,
    // unguessable string, set only once an entry is actually invited. Null
    // for every entry still waiting: there is no state where a token exists
    // but nothing has been offered to the customer holding it.
    //
    // Stored as plain text rather than hashed: it is not a password (nothing
    // else authenticates this customer, so there is no credential reuse to
    // protect against), and hashing it would turn the public lookup this
    // enables into a table scan instead of an indexed equality check.
    inviteToken: text("invite_token"),

    // When the invite stops being redeemable. Set alongside inviteToken —
    // never one without the other.
    inviteExpiresAt: timestamp("invite_expires_at", { withTimezone: true }),

    // When the token was actually spent placing an order. Null means
    // unused. This is what makes a token single-use: consuming it means
    // writing this column, in the same transaction that creates the order,
    // and every check re-reads it under a row lock so two racing redemptions
    // of the same link can't both succeed.
    inviteUsedAt: timestamp("invite_used_at", { withTimezone: true }),

    ...timestamps,
  },
  (table) => [
    // One phone number can wait on several different books, but not join the
    // same book's list twice. Postgres treats every NULL as distinct under a
    // plain unique index, so a bare (phone, bookId) index would silently let
    // the general waitlist (bookId null) collect duplicate signups from the
    // same phone — hence two partial indexes instead of one.
    uniqueIndex("waitlist_entries_phone_book_idx")
      .on(table.customerPhone, table.bookId)
      .where(sql`${table.bookId} is not null`),

    // ...and not join the general (book-less) waitlist twice either.
    uniqueIndex("waitlist_entries_phone_general_idx")
      .on(table.customerPhone)
      .where(sql`${table.bookId} is null`),

    index("waitlist_entries_status_idx").on(table.status),
    index("waitlist_entries_book_id_idx").on(table.bookId),

    // Partial: most rows never have a token, and the public invite lookup
    // only ever queries the rows that do. Unique so two entries can never
    // collide on the same link even if the generator ever repeated itself.
    uniqueIndex("waitlist_entries_invite_token_idx")
      .on(table.inviteToken)
      .where(sql`${table.inviteToken} is not null`),
  ],
);

export const waitlistEntriesRelations = relations(waitlistEntries, ({ one }) => ({
  book: one(books, { fields: [waitlistEntries.bookId], references: [books.id] }),
  convertedOrder: one(orders, {
    fields: [waitlistEntries.convertedOrderId],
    references: [orders.id],
  }),
}));
