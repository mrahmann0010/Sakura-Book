import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { adminUsers } from "../admin/admin-user";
import { books } from "../catalog/book";
import { waitlistAllocationStatusEnum } from "../enums";
import { timestamps } from "../timestamps";

/**
 * How much of a restock the waitlist is allowed to eat.
 *
 * ## Why this table exists
 *
 * A print run is not the same thing as a queue's entitlement. Before this,
 * the invite budget was `stock_quantity` — the whole run — so a shop with 60
 * copies and 300 people waiting could hold all 60 for the list, and every
 * walk-in customer saw "sold out" for the length of the invite window. A shop
 * that only ever serves its backlog never acquires anyone new, so the split is
 * a decision the shop makes deliberately, once per release, before a single
 * person is contacted.
 *
 * ## `copies` holds inventory back, and it does so by arithmetic
 *
 * The shop's walk-in reserve is not marked or held anywhere, and does not need
 * to be: `publicAvailableSql` is `stock − live holds − this release's unspent
 * budget`, so the counter's ten copies are what is left over rather than
 * something anybody writes down.
 *
 * The middle term was missing at first, and the gap was the whole feature's
 * honesty. With only `stock − live holds`, `copies` capped what *staff* could
 * hand out and nothing more — so a shop that gave the queue fifty of sixty at
 * nine in the morning could sell all sixty to walk-ins by eleven, and every
 * invite issued afterwards was refused for lack of physical stock. The set-
 * aside now takes effect when the decision is made rather than when the texts
 * go out.
 *
 * Derived rather than stored, and that is the safer of the two shapes. A second
 * `reserved_for_walk_ins` column would be a number that has to agree with this
 * one on every read, every restock and every manual stock correction — and the
 * first time it did not, the shop would either strand copies or oversell them
 * with both columns looking plausible.
 *
 * ## What is not stored here
 *
 * How many copies this release has already spent. That is
 * `WaitlistAllocationService.committed`, summed from the invites themselves on
 * every read, for the reason `reservedQuantitySql` gives at length: a stored
 * total would be faster and would eventually be wrong, because every issue,
 * redemption, expiry and revocation would have to remember to adjust it.
 *
 * The expiry case is what settles it. A window closing is not an event anybody
 * writes — it is just time passing — so a counter could only learn about it
 * from a sweep, and a sweep that fails to run leaves copies stranded with
 * nothing able to detect that they are. Summed from the invites, recycling
 * stops being an operation at all: `remaining` simply goes up when a window
 * closes.
 */
export const waitlistAllocations = pgTable(
  "waitlist_allocations",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    /* `restrict`, unlike waitlist_entries.book_id which is `set null`. An
       entry with no book is still a record of someone who asked; an allocation
       with no book is a budget against nothing, and the invites charged to it
       would be accounted for by no query. Deleting a book that has a release
       on it should fail loudly and make someone close the release first. */
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "restrict" }),

    /** The waitlist's budget for this release, in copies. */
    copies: integer("copies").notNull(),

    /**
     * `books.stock_quantity` at the moment the decision was made.
     *
     * Not used in any arithmetic — `spendable` reads live stock, because that
     * is what the shop actually has. This is here so "50 of 60" is still
     * legible next year, when the stock count has moved several times and the
     * release's own number on its own says nothing about what it was a share
     * of.
     */
    stockSnapshot: integer("stock_snapshot").notNull(),

    /** Staff-facing: "Sept restock, 10 held for the shop counter". */
    note: text("note"),

    status: waitlistAllocationStatusEnum("status").notNull().default("OPEN"),

    /* Denormalised email alongside the FK, the same pair shop_settings keeps
       and for the same reason: the admin row may be deleted, and "who decided
       to give the queue 50 of these" is exactly the fact an audit needs to
       survive that. */
    openedById: uuid("opened_by_id").references(() => adminUsers.id, { onDelete: "set null" }),
    openedByEmail: text("opened_by_email"),

    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedById: uuid("closed_by_id").references(() => adminUsers.id, { onDelete: "set null" }),
    closedByEmail: text("closed_by_email"),

    ...timestamps,
  },
  (table) => [
    /**
     * One open release per book, enforced here rather than in a service.
     *
     * Two open budgets for the same title is two people spending the same
     * copies: each would compute `remaining` against its own `copies` and
     * neither would see the other's invites as charged, so the pair could
     * issue twice the intended number of holds while both looked correct.
     *
     * Partial, so the closed history is unconstrained — a book accumulates one
     * row per restock and they must all be allowed to coexist.
     */
    uniqueIndex("waitlist_allocations_open_per_book_idx")
      .on(table.bookId)
      .where(sql`${table.status} = 'OPEN'`),

    index("waitlist_allocations_book_id_idx").on(table.bookId),

    /* A release of zero copies is not a release, it is a closed one written
       the long way round — and it would sit there as the book's one OPEN row
       refusing every invite with "no copies allocated", which reads as a bug
       rather than as a decision. */
    check("waitlist_allocations_copies_positive", sql`${table.copies} > 0`),

    /**
     * A closed release records when and by whom; an open one records neither.
     *
     * Same argument as `waitlist_entries_invite_columns_together`: the service
     * writes `status`, `closed_at` and the closer together, every reader
     * assumes it, and the assumption's only backing was that the one method
     * doing it happened to be right. A CLOSED row with no `closed_at` renders
     * as a release that ended at no particular time, which is unanswerable
     * afterwards.
     */
    check(
      "waitlist_allocations_closed_columns_together",
      sql`(${table.status} = 'CLOSED') = (${table.closedAt} is not null)`,
    ),
  ],
);

export const waitlistAllocationsRelations = relations(waitlistAllocations, ({ one }) => ({
  book: one(books, { fields: [waitlistAllocations.bookId], references: [books.id] }),
}));
