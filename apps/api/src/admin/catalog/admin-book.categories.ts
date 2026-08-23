/* --------------------------------------------------------------------------
   Which category selections describe a book this shop can sell.

   Split out of admin-books.service.ts for the same reason admin-book.query.ts
   is: the rule is a pure decision over rows, the service's job is fetching
   them, and only one of those two can be tested without a database.
   -------------------------------------------------------------------------- */

/**
 * The category groups a new book must be filed under.
 *
 * Values rather than an enum on `categories.group` — the column is a
 * `varchar`, and the storefront reads these same two strings ("skill" for its
 * only facet row, "level" for the JLPT filter). If a third group ever becomes
 * mandatory it is added here and nowhere else; the admin form derives its own
 * required markers from the taxonomy it fetches.
 */
export const REQUIRED_CATEGORY_GROUPS = ["skill", "level"] as const;

export type RequiredCategoryGroup = (typeof REQUIRED_CATEGORY_GROUPS)[number];

/** How each required group is named to the person filling in the form. */
const GROUP_LABELS: Record<RequiredCategoryGroup, string> = {
  skill: "skill",
  level: "JLPT level",
};

/** Just enough of a `categories` row to judge a selection. */
export type CategoryRow = { slug: string; group: string };

export type CategoryProblem = {
  message: string;
  details: Record<string, unknown>;
};

/**
 * What is wrong with a set of category slugs, or `null` if nothing is.
 *
 * Two rules, and neither is expressible in the request schema because both
 * need the taxonomy: a slug's group is a row in `categories`.
 *
 * *Unknown slugs are rejected.* The lookup this replaces filtered silently —
 * `where slug in (...)`, then insert whatever came back — which made a typo
 * indistinguishable from a correct save: the request returned 200 and the book
 * came out with fewer categories than the operator picked. Survivable while
 * categories were decorative; not now that they are the mandatory part, since
 * "n05" for "n5" would drop the level and still satisfy a check that only
 * counted what the lookup returned.
 *
 * *Skill and level must both be covered*, when `requireCoverage` is set. Every
 * book here is JLPT prep and the storefront's facets are the skill group, so a
 * title filed under neither is one no customer browsing by skill or level can
 * reach. `genre` is deliberately not required — it is the vocabulary the
 * catalog stopped filtering on, and demanding it would be demanding a dead
 * field.
 *
 * Unknown slugs are reported before missing groups: told both at once, an
 * operator who mistyped "n05" would be shown "pick a JLPT level" next to a
 * level they thought they had picked.
 */
export function categorySelectionProblem(
  wanted: readonly string[],
  found: readonly CategoryRow[],
  requireCoverage: boolean,
): CategoryProblem | null {
  if (wanted.length === 0) {
    return requireCoverage
      ? {
          message: `Pick at least one ${labelList([...REQUIRED_CATEGORY_GROUPS])}.`,
          details: { field: "categorySlugs", missingGroups: [...REQUIRED_CATEGORY_GROUPS] },
        }
      : null;
  }

  const known = new Set(found.map((row) => row.slug));
  const unknown = wanted.filter((slug) => !known.has(slug));

  if (unknown.length > 0) {
    return {
      message: `Unknown categor${unknown.length === 1 ? "y" : "ies"}: ${unknown.join(", ")}.`,
      details: { field: "categorySlugs", unknown },
    };
  }

  if (requireCoverage) {
    const missing = REQUIRED_CATEGORY_GROUPS.filter(
      (group) => !found.some((row) => row.group === group),
    );

    if (missing.length > 0) {
      return {
        message: `Pick at least one ${labelList(missing)}.`,
        details: { field: "categorySlugs", missingGroups: missing },
      };
    }
  }

  return null;
}

/** "skill" / "skill and one JLPT level" — reads as a sentence either way. */
function labelList(groups: readonly RequiredCategoryGroup[]): string {
  return groups.map((group) => GROUP_LABELS[group]).join(" and one ");
}
