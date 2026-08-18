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
   * The five regions the checkout form already offers. Slugs match the values
   * in apps/web/src/lib/checkout.ts, which is what makes this table a
   * replacement for that list rather than a second, disagreeing one.
   *
   * All five take the flat national rate today — `deliveryCentsOverride` stays
   * null. The column exists because a Bangladeshi shop charging the same
   * inside and outside Dhaka is the exception, and discovering that after
   * there are live orders would be a migration under load.
   */
  await db
    .insert(deliveryRegions)
    .values([
      { slug: "dhaka", name: "Dhaka", sortOrder: 1 },
      { slug: "chattogram", name: "Chattogram", sortOrder: 2 },
      { slug: "sylhet", name: "Sylhet", sortOrder: 3 },
      { slug: "khulna", name: "Khulna", sortOrder: 4 },
      { slug: "rajshahi", name: "Rajshahi", sortOrder: 5 },
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
