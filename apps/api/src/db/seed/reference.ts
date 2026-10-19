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
   * The three Pathao tiers, one row each — the slugs are TIER_REGION_SLUG in
   * @sakura/contracts. A row's `deliveryCentsOverride` is that tier's ≤0.5kg
   * start price, which staff edit; the weight steps above it live with the
   * ladder in shipping-rates.ts. The figures here are Pathao's published ones
   * and match that file's defaults, so a fresh database and a missing row
   * price the same.
   *
   * `inside-dhaka` and `outside-dhaka` keep their original slugs because
   * orders already name them. On a database seeded before the suburb tier
   * existed this inserts only `dhaka-suburb` and leaves the other two — and
   * whatever staff have saved on them — alone.
   */
  await db
    .insert(deliveryRegions)
    .values([
      { slug: "inside-dhaka", name: "Inside Dhaka", sortOrder: 1, deliveryCentsOverride: 6000 },
      { slug: "dhaka-suburb", name: "Dhaka Suburbs", sortOrder: 2, deliveryCentsOverride: 8000 },
      { slug: "outside-dhaka", name: "Outside Dhaka", sortOrder: 3, deliveryCentsOverride: 11000 },
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
