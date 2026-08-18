import { boolean, integer, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "../timestamps";

/**
 * The delivery regions a customer may pick at checkout.
 *
 * A table rather than a constant because this vocabulary is deliberately not
 * in @sakura/contracts: freezing today's five Bangladeshi regions into a shared
 * package would make adding a sixth a package release consumed by two apps.
 * `region` travels the wire as a slug string and is validated against these
 * rows server-side.
 *
 * `deliveryCentsOverride` is the reason the table earns its keep. A flat
 * national rate cannot express the inside/outside-Dhaka split that is the norm
 * here, and discovering that later would mean either a migration under live
 * orders or a second postage mechanism. Null means "the flat rate applies",
 * which is every row today.
 */
export const deliveryRegions = pgTable("delivery_regions", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),

  /**
   * English name. Clients translate by slug — the bn and ja bundles key off
   * it — so this is a fallback label and an operator-facing name, never the
   * only thing a customer can be shown.
   */
  name: text("name").notNull(),

  /** Minor units. Null → ShippingPolicy's flat rate. */
  deliveryCentsOverride: integer("delivery_cents_override"),

  sortOrder: integer("sort_order").notNull().default(0),

  /**
   * Soft-delete. A region that stops being served must not vanish from the
   * historical orders that name it, and orders snapshot the region string, so
   * this only controls what checkout offers.
   */
  isActive: boolean("is_active").notNull().default(true),

  ...timestamps,
});
