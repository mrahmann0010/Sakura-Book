import type { Database } from "../db.types";
import { categories, deliveryRegions } from "../schema";

/**
 * Reference data: rows the application is wrong without.
 *
 * Separated from the sample catalog because these two have opposite lifetimes.
 * A production database needs every row in this file — checkout rejects any
 * region that is not in the table, so an unseeded production shop cannot take
 * an order at all — and needs none of the file next to it.
 *
 * Every insert is `onConflictDoNothing` on the natural key, so this is safe to
 * re-run on a live database. It deliberately does not update existing rows:
 * postage overrides and category names are things staff edit, and a deploy
 * step that silently reverts their edits back to what a developer wrote months
 * ago is worse than one that does nothing.
 */
export async function seedReference(db: Database): Promise<void> {
  /**
   * The two zones the checkout form derives from the customer's chosen
   * division: "Dhaka" division maps to `inside-dhaka`, every other division
   * maps to `outside-dhaka`. Slugs match apps/web/src/lib/checkout.ts and
   * apps/web/src/lib/bd-geo.ts, which is what makes this table a replacement
   * for that list rather than a second, disagreeing one.
   *
   * Both carry a real `deliveryCentsOverride` — the flat national rate is now
   * only the fallback for an unrecognised or absent slug, not what either zone
   * actually charges.
   */
  await db
    .insert(deliveryRegions)
    .values([
      { slug: "inside-dhaka", name: "Inside Dhaka", sortOrder: 1, deliveryCentsOverride: 6000 },
      { slug: "outside-dhaka", name: "Outside Dhaka", sortOrder: 2, deliveryCentsOverride: 12000 },
    ])
    .onConflictDoNothing({ target: deliveryRegions.slug });

  /**
   * The genre facet the catalog page draws, as categories.
   *
   * `group` is "genre" for all five, which is what makes them render as one
   * section of the filter rail rather than five loose tags. The level/skill
   * groups the category table's comment anticipates are not seeded: inventing
   * a JLPT taxonomy for a shelf whose real contents are not loaded yet would
   * be putting a guess in the one table that is supposed to be authoritative.
   */
  await db
    .insert(categories)
    .values([
      { slug: "fiction", name: "Fiction", group: "genre", sortOrder: 1 },
      { slug: "essays", name: "Essays", group: "genre", sortOrder: 2 },
      { slug: "poetry", name: "Poetry", group: "genre", sortOrder: 3 },
      { slug: "translated", name: "Translated", group: "genre", sortOrder: 4 },
      { slug: "nature", name: "Nature", group: "genre", sortOrder: 5 },
    ])
    .onConflictDoNothing({ target: categories.slug });
}
