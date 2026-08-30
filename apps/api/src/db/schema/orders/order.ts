import { relations, sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { orderStatusEnum, paymentMethodEnum, paymentProviderEnum } from "../enums";
import { coupons } from "../marketing/coupon";
import { timestamps } from "../timestamps";
import { orderItems } from "./order-item";
import { orderStatusHistory } from "./order-status-history";
import { payments } from "./payment";

/**
 * The address as the customer entered it, frozen.
 *
 * The fields are `shippingAddressSchema`'s in @sakura/contracts minus the three
 * that are columns on this table (name, email, phone) — those are indexed and
 * queried for order lookup, and a jsonb copy of an indexed column is a second
 * value that can disagree with the first.
 *
 * Not the generic line1/postalCode/country shape this started as: the shop
 * serves Bangladesh only, the form has no postcode field, and `region` is a
 * slug from the regions table that postage will eventually be priced off. An
 * international address model can be added the day there is an international
 * order to store in it.
 */
export type ShippingAddress = {
  address: string;
  city: string;
  /** Region slug, as sent — validated against the regions table at checkout. */
  region: string;

  /**
   * The address form's own fields, stored beside the line they compose.
   *
   * `address` is the join of these plus the free-text detail, and stays the
   * address a customer and a courier read. These are kept because a courier
   * manifest needs the levels apart — Pathao addresses a parcel as
   * district → upazila → area — and because recovering them by splitting the
   * joined string back up does not work: the join drops empty parts, so the
   * line above the district is the area on one order and a house number on
   * the next. See shippingAddressSchema in @sakura/contracts.
   *
   * Optional, and absent on every order placed before they were added. Nothing
   * may assume they are present.
   */
  upazila?: string;
  area?: string;
  postCode?: string;
};

export const orders = pgTable(
  "orders",
  {
    // Not sequential, and never shown to a customer — see orderNumber.
    id: uuid("id").defaultRandom().primaryKey(),

    /**
     * The human-quotable id: eight characters, "NB-40718", exactly as the
     * confirmation copy promises and the design system's `OrderId` renders.
     *
     * A separate column rather than a formatted view of `id`, because it has to
     * be readable over the phone — and separate from a sequence, because a
     * guessable order number plus an email is the entire authentication of
     * /orders/lookup. Minted in application code with a uniqueness retry (see
     * orders/order-number.ts); the unique index here is what makes that retry
     * correct rather than hopeful.
     */
    orderNumber: text("order_number").notNull().unique(),

    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email").notNull(),
    customerPhone: text("customer_phone").notNull(),
    shippingAddress: jsonb("shipping_address").$type<ShippingAddress>().notNull(),

    subtotalCents: integer("subtotal_cents").notNull(),
    shippingCents: integer("shipping_cents").notNull(),

    // Both the FK and the snapshot are kept, deliberately. couponId answers
    // "which orders used this coupon" and ties the order to the row whose
    // timesUsed it incremented; the snapshot columns freeze what the customer
    // actually saw and was charged. Same principle as book price/title on
    // orderItems: never recompute discountCents from the live coupon row.
    couponId: uuid("coupon_id").references(() => coupons.id, { onDelete: "set null" }),
    discountCodeSnapshot: text("discount_code_snapshot"), // the code as applied, e.g. "SAVE10"
    discountCents: integer("discount_cents").notNull().default(0),

    // subtotalCents + shippingCents - discountCents
    totalCents: integer("total_cents").notNull(),

    customerNote: text("customer_note"), // customer-facing: "gift wrap", "leave at gate", etc.
    internalNote: text("internal_note"), // staff-only: never shown to customer

    // Generated client-side (UUID) at checkout start, sent with the order-creation
    // request. Backend checks this before inserting a new order — prevents duplicate
    // orders/charges from double-clicks or network retries, which matters more here
    // since there's no account/order-history system to help a customer notice or
    // dispute a double charge.
    idempotencyKey: text("idempotency_key").unique(),

    // What the customer chose at checkout. Recorded on the order because COD
    // produces no payments row until delivery, so the payments table cannot
    // answer "how is this order being paid for" for the most common method.
    paymentMethod: paymentMethodEnum("payment_method").notNull(),

    /**
     * Which wallet a manual-transfer payment moved through — bKash, Rocket or
     * Nagad. Collected explicitly at checkout rather than left to be inferred
     * from `transactionId`, whose format alone does not name a wallet.
     *
     * Nullable for the same reason `senderNumber`/`transactionId` are: cash on
     * delivery moves through no wallet at all.
     */
    provider: paymentProviderEnum("provider"),

    /**
     * The manual-transfer receipt: the wallet number the money was sent from,
     * and the transaction ID printed on the bKash/Nagad confirmation.
     *
     * Both are already collected and validated by `checkoutSchema` — required
     * whenever `method` is `manual-transfer` — and until this column existed
     * the API discarded them at the boundary. That left staff verifying
     * transfers against nothing: the customer had typed a receipt number the
     * shop never stored, so an order could only be reconciled by asking them
     * for it again.
     *
     * Nullable because cash on delivery has no receipt to record. The
     * requiredness is the request schema's job, not the column's — a NOT NULL
     * here would have to be satisfied with an empty string for every COD
     * order, which is a worse lie than a null.
     */
    senderNumber: text("sender_number"),
    transactionId: text("transaction_id"),

    /**
     * `transactionId` reduced to the form two receipts are compared in:
     * uppercased, with every non-alphanumeric character removed. `pay 123`,
     * `PAY-123` and `PAY123` are one receipt and must collide.
     *
     * Generated by Postgres rather than written by the API, which is the whole
     * point of the column. The reuse check used to normalise in TypeScript on
     * the way in and in SQL on the way out, and the two did not agree: JS `\s`
     * matches a non-breaking space, POSIX `\s` does not, so a receipt pasted
     * out of an SMS with a U+00A0 in it was stored one way and searched for
     * another and never matched itself. One receipt, two orders, both accepted.
     * A generated column cannot drift from itself.
     *
     * Stripping all punctuation rather than only whitespace also closes the
     * `PAY-123` / `PAY123` pair, which the old check treated as two receipts.
     *
     * `nullif(…, '')` so a receipt of pure punctuation lands as NULL rather
     * than an empty string: NULLs do not collide under the unique index below,
     * and "no usable receipt" is what that value means.
     *
     * Mirrored in `normaliseTransactionId` for the one thing SQL cannot do —
     * normalise a value that is not in the table yet, at the API boundary.
     * The two must stay identical; the test suite asserts they agree.
     */
    transactionIdNormalised: text("transaction_id_normalised").generatedAlwaysAs(
      sql`nullif(upper(regexp_replace(coalesce("transaction_id", ''), '[^A-Za-z0-9]', '', 'g')), '')`,
    ),

    // Denormalized "current status" for fast reads. The append-only log in
    // orderStatusHistory is the source of truth for how the order got here.
    status: orderStatusEnum("status").notNull().default("PENDING"),

    ...timestamps,
  },
  // Indexed for the Track Order lookup (order ID + email/phone), so this stays
  // fast as order volume grows rather than degrading to a full scan.
  (table) => [
    index("orders_customer_email_idx").on(table.customerEmail),
    index("orders_customer_phone_idx").on(table.customerPhone),

    /* "Which order is this receipt for?" — the question a member of staff asks
       with a bKash statement open beside the queue, typing what the statement
       shows. Kept alongside the normalised index below because this one
       answers the literal search; that one answers "is this the same
       receipt?", which is a different question. */
    index("orders_transaction_id_idx").on(table.transactionId),

    /**
     * One live order per receipt, enforced by the database.
     *
     * The reuse check in `findTransactionIdClaim` remains, and remains the
     * thing that produces the message staff read — an index cannot name the
     * order already holding the receipt, and that name is the most useful part
     * of the answer. What an index can do, and the query cannot, is survive
     * two checkouts that read before either commits. At READ COMMITTED both of
     * them see an unspent receipt and both insert; nothing but a constraint
     * stops the second one.
     *
     * Partial on status, because a cancelled or refunded order has let go of
     * its claim: the shop either never took the money or has sent it back, and
     * the customer re-placing that order with the same receipt is doing the
     * right thing. This is the same rule as `RELEASED_STATUSES`, and the two
     * are asserted equal in the test suite so they cannot drift.
     */
    uniqueIndex("orders_transaction_id_live_unique_idx")
      .on(table.transactionIdNormalised)
      .where(sql`"status" <> 'CANCELLED' AND "status" <> 'REFUNDED'`),

    /**
     * The admin fulfilment queue's index.
     *
     * `(status, created_at desc)` in that order because the queue is almost
     * always filtered by status first and then read newest-first within it —
     * "everything still to pack, most recent at the top". The reverse order
     * would make the status filter a scan of every order ever placed.
     *
     * The sort direction is in the index rather than left to Postgres to
     * reverse. It can walk a btree backwards, but not while also honouring the
     * `id` tiebreak that keeps offset pagination stable — and an unstable
     * fulfilment queue silently omits orders between pages.
     */
    index("orders_status_created_idx").on(table.status, table.createdAt.desc(), table.id),

    /** The unfiltered queue, and the dashboard's "orders today". */
    index("orders_created_idx").on(table.createdAt.desc(), table.id),

    /**
     * Trigram index for the queue's free-text search over the customer's name.
     *
     * Same reasoning and the same schema-qualified operator class as
     * `books_title_trgm_idx` — see that comment for why `extensions.` is
     * spelled out. Email and phone already have btree indexes above; those
     * serve the exact-match half of the search, and a leading-wildcard ILIKE
     * on them falls back to a scan that is acceptable at this table's size.
     * The name has no index at all otherwise, and it is the field staff
     * actually search by.
     */
    index("orders_customer_name_trgm_idx").using(
      "gin",
      sql`${table.customerName} extensions.gin_trgm_ops`,
    ),
  ],
);

export const ordersRelations = relations(orders, ({ one, many }) => ({
  coupon: one(coupons, { fields: [orders.couponId], references: [coupons.id] }),
  items: many(orderItems),
  statusHistory: many(orderStatusHistory),
  payments: many(payments),
}));
