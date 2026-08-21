import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { adminUsers } from "../admin/admin-user";

/**
 * Shop policy that staff may change without a deploy.
 *
 * ## One row, enforced
 *
 * The primary key is a fixed string with a check constraint pinning it to one
 * value, so a second settings row is not something the database will store.
 * That is worth a constraint rather than a convention: with two rows, every
 * read needs an ordering to pick between them, and whichever one loses becomes
 * a set of numbers that look edited and price nothing. The failure would be
 * invisible — the panel would show the saved value and checkout would charge
 * the other one.
 *
 * ## Why these columns and not a key/value bag
 *
 * A `settings(key, value jsonb)` table is the tempting shape and it gives up
 * the two things that matter here: the column types, and the ability to say
 * `not null`. These numbers are multiplied into what customers are charged, so
 * "the free-delivery threshold is the string 'free'" must be a write that
 * fails, not a read that surprises `ShippingPolicy`.
 *
 * ## Why nullable
 *
 * Null means "not configured — use the environment's value". That is not the
 * same as zero, which is a legitimate setting meaning free delivery always.
 * Collapsing the two would make a shop that has never touched its settings
 * indistinguishable from one running a permanent free-delivery campaign.
 */
export const shopSettings = pgTable(
  "shop_settings",
  {
    id: text("id").primaryKey().default("singleton"),

    /** Minor units. Null → DELIVERY_FLAT_CENTS from the environment. */
    deliveryFlatCents: integer("delivery_flat_cents"),

    /** Minor units. Null → FREE_DELIVERY_THRESHOLD_CENTS from the environment. */
    freeDeliveryThresholdCents: integer("free_delivery_threshold_cents"),

    /**
     * Where the shop is currently shipping from. Null → WAREHOUSE_DIVISION from
     * the environment.
     *
     * A single slug rather than an address: this only has to answer "is the
     * destination the same broad zone as where we're shipping from", the same
     * question `deliveryCentsOverride` on `delivery_regions` prices. A shop
     * with more than one shipment point active *at once* needs an
     * origin×destination matrix instead of this column — this is the "one
     * shipment point that moves" case only.
     */
    originDivision: text("origin_division"),

    /**
     * Who last saved, and when.
     *
     * Denormalised alongside the FK for the same reason `audit_log` freezes
     * the actor's email: the panel shows "changed by X" next to a number that
     * governs every price on the site, and that attribution must survive the
     * account being disabled or deleted.
     */
    updatedById: uuid("updated_by_id").references(() => adminUsers.id, { onDelete: "set null" }),
    updatedByEmail: text("updated_by_email"),

    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("shop_settings_singleton", sql`${table.id} = 'singleton'`),
    /**
     * Negative postage would be a discount applied to everyone, silently, and
     * a negative threshold would waive delivery on an empty cart. Both are
     * also refused by the request schema — this is the backstop for a write
     * that did not come through it, which is exactly the kind of write a
     * settings table attracts.
     */
    check(
      "shop_settings_non_negative",
      sql`(${table.deliveryFlatCents} is null or ${table.deliveryFlatCents} >= 0)
          and (${table.freeDeliveryThresholdCents} is null or ${table.freeDeliveryThresholdCents} >= 0)`,
    ),
  ],
);
