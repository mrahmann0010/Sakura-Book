import { Injectable } from "@nestjs/common";
import type { CategoryGroup } from "@sakura/contracts";
import { asc } from "drizzle-orm";
import { DbService } from "../db/db.service";
import type { Executor } from "../db/db.types";
import { categories } from "../db/schema";

/**
 * The filter rail's vocabulary.
 *
 * `categories.group` ("level", "skill", "format", "collection") is what makes
 * the rail render as sections rather than one flat list of tags, so the API
 * returns it pre-grouped: the alternative is every client reimplementing the
 * same reduce, in three locales, and disagreeing about the order.
 */
@Injectable()
export class CategoriesService {
  constructor(private readonly dbService: DbService) {}

  /**
   * All categories, grouped, both levels ordered by `sort_order`.
   *
   * Groups appear in the order their first category does, which makes
   * `sort_order` the single knob controlling the rail — an operator moving a
   * category to the top of its group cannot accidentally reorder the groups
   * themselves, because the group's position is decided by its lowest-sorted
   * member and that member is the one they are moving.
   *
   * No filtering on "has books". An empty category in the rail is a curation
   * signal the shop's own staff should see; hiding it would make a
   * miscategorised import invisible instead of obvious.
   */
  async grouped(executor: Executor = this.dbService.db): Promise<CategoryGroup[]> {
    const rows = await executor
      .select({
        slug: categories.slug,
        name: categories.name,
        group: categories.group,
      })
      .from(categories)
      .orderBy(asc(categories.sortOrder), asc(categories.name));

    const groups = new Map<string, CategoryGroup>();

    for (const row of rows) {
      const existing = groups.get(row.group);

      if (existing) existing.categories.push({ slug: row.slug, name: row.name });
      else
        groups.set(row.group, {
          group: row.group,
          categories: [{ slug: row.slug, name: row.name }],
        });
    }

    return [...groups.values()];
  }
}
