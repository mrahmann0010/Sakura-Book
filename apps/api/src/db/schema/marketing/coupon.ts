import { relations, sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { couponDiscountTypeEnum } from "../enums";
import { orders } from "../orders/order";
import { timestamps } from "../timestamps";

export const coupons = pgTable(
  "coupons",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    // Stored uppercase and matched case-insensitively. Normalisation happens in
    // CouponsService.normalizeCode — the unique constraint below only holds if
    // every write goes through it, so never insert a raw user string here.
    code: text("code").notNull().unique(),

    discountType: couponDiscountTypeEnum("discount_type").notNull(),
    // Percentage (1-100) OR cents, depending on discountType.
    discountValue: integer("discount_value").notNull(),

    // Optional: coupon only valid at or above this subtotal.
    minOrderCents: integer("min_order_cents"),
    // Optional cap, mainly relevant for PERCENTAGE — stops "10% off" being
    // unlimited on a very large order.
    maxDiscountCents: integer("max_discount_cents"),

    maxUses: integer("max_uses"), // null = unlimited
    timesUsed: integer("times_used").notNull().default(0),

    startsAt: timestamp("starts_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),

    // Manual kill-switch, independent of expiry.
    isActive: boolean("is_active").notNull().default(true),

    ...timestamps,
  },
  (table) => [
    // A percentage outside 1-100 silently produces a nonsense discount, and a
    // negative fixed amount would *increase* the total. Both are cheap to
    // reject at the database rather than trusting every future write path.
    check(
      "coupons_discount_value_valid",
      sql`(${table.discountType} = 'PERCENTAGE' AND ${table.discountValue} BETWEEN 1 AND 100)
       OR (${table.discountType} = 'FIXED_AMOUNT' AND ${table.discountValue} > 0)`,
    ),
    check("coupons_max_uses_positive", sql`${table.maxUses} IS NULL OR ${table.maxUses} > 0`),
    // Backs the case-insensitive lookup: matching is done by uppercasing the
    // user's input and comparing exactly, which is only correct if stored codes
    // are guaranteed uppercase. This makes that a database invariant, not a
    // convention. Also rejects blank codes.
    check("coupons_code_uppercase", sql`${table.code} = upper(${table.code}) AND length(${table.code}) > 0`),
    check(
      "coupons_valid_window",
      sql`${table.startsAt} IS NULL OR ${table.expiresAt} IS NULL OR ${table.startsAt} < ${table.expiresAt}`,
    ),
  ],
);

export const couponsRelations = relations(coupons, ({ many }) => ({
  orders: many(orders),
}));
