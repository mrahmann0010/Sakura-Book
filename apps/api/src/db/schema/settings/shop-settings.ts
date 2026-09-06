import { sql } from "drizzle-orm";
import { check, date, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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

    /** Receiving number shown at checkout. Null → BKASH_NUMBER from the environment. */
    bkashNumber: text("bkash_number"),
    /** Receiving number shown at checkout. Null → ROCKET_NUMBER from the environment. */
    rocketNumber: text("rocket_number"),
    /** Receiving number shown at checkout. Null → NAGAD_NUMBER from the environment. */
    nagadNumber: text("nagad_number"),

    /**
     * When ordering reopens — the date the /notify page announces, shop-wide.
     *
     * `date` rather than `timestamptz`, and this is the one column here where
     * that distinction is the whole point: this is a day on a calendar, not an
     * instant. "September 15" must read as September 15 to a customer in Dhaka
     * and to staff wherever they are, and a timestamp would shift it across the
     * boundary for one of them depending on the zone it was rendered in.
     *
     * Null means "no date announced" and the line is omitted rather than
     * rendered empty — a promise the shop has not made is better said by
     * silence than by a blank. It replaces a hardcoded constant in the notify
     * page, which is why the migration backfills the date that constant held:
     * deploying this must not silently retract a date customers have seen.
     *
     * Shop-wide, not per book. Every waitlist signup today is for the same
     * reopening, and a per-title date is a different feature — it would belong
     * on `books`, not here.
     */
    reopenDate: date("reopen_date"),

    /**
     * Which SIM slot the admin "Send SMS" panel (and any other transactional
     * text) sends from. Null → let the gateway app's own sim_selection_mode
     * setting decide, same "unconfigured" meaning as the other columns here.
     *
     * Lives here rather than as component state on the Send SMS page: a phone
     * gateway's SIM choice is a fact about the shop's messaging setup, not
     * something to reselect on every message, and a value only React
     * remembers is gone on the next refresh — see the column's own history.
     */
    smsSimNumber: integer("sms_sim_number"),

    /**
     * How many hours a waitlist invite link stays redeemable after
     * `WaitlistInviteService.issue()` mints it. Null → the service's own
     * 48-hour default, same "unconfigured" meaning as every other column
     * here — staff who never open this setting still get a sane TTL.
     */
    waitlistInviteTtlHours: integer("waitlist_invite_ttl_hours"),

    /**
     * Which language the invite SMS is written in. Null → "customer", the
     * same meaning as every other column here except it names a fallback
     * rather than a number: with no staff override, the text goes out in
     * whatever locale the waitlist entry itself was submitted under (see
     * `waitlistEntries.locale`). "en" or "bn" pins every invite to that
     * language regardless of what the customer signed up under.
     */
    waitlistInviteLanguage: text("waitlist_invite_language"),

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
    check(
      "shop_settings_sms_sim_number_range",
      sql`${table.smsSimNumber} is null or ${table.smsSimNumber} between 1 and 3`,
    ),
    check(
      "shop_settings_waitlist_invite_ttl_hours_range",
      sql`${table.waitlistInviteTtlHours} is null or ${table.waitlistInviteTtlHours} between 1 and 720`,
    ),
    check(
      "shop_settings_waitlist_invite_language_values",
      sql`${table.waitlistInviteLanguage} is null or ${table.waitlistInviteLanguage} in ('en', 'bn', 'customer')`,
    ),
  ],
);
