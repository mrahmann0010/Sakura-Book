import { describe, expect, it } from "vitest";
import {
  REQUIRED_CATEGORY_GROUPS,
  categorySelectionProblem,
  type CategoryRow,
} from "../../src/admin/catalog/admin-book.categories";

/**
 * The half of the "skill and JLPT level are mandatory" rule that the request
 * schema cannot express, because a slug's group is a row in `categories`.
 *
 * The failure this guards against is not a rejected save — that is loud. It is
 * the opposite: a selection that should have been rejected being accepted, so
 * a book is created filed under nothing a customer can browse by.
 */

const taxonomy: Record<string, CategoryRow> = {
  grammar: { slug: "grammar", group: "skill" },
  kanji: { slug: "kanji", group: "skill" },
  n5: { slug: "n5", group: "level" },
  n3: { slug: "n3", group: "level" },
  fiction: { slug: "fiction", group: "genre" },
};

/** The rows the service's lookup would return for a set of slugs. */
function found(...slugs: string[]): CategoryRow[] {
  return slugs.filter((slug) => slug in taxonomy).map((slug) => taxonomy[slug]);
}

describe("categorySelectionProblem", () => {
  it("accepts a skill and a level", () => {
    const wanted = ["grammar", "n5"];

    expect(categorySelectionProblem(wanted, found(...wanted), true)).toBeNull();
  });

  it("accepts several of each, plus an unrequired group alongside", () => {
    // A reference title spanning N5–N1 is the real case for more than one
    // level, and `genre` riding along must not make the selection invalid.
    const wanted = ["grammar", "kanji", "n5", "n3", "fiction"];

    expect(categorySelectionProblem(wanted, found(...wanted), true)).toBeNull();
  });

  it("rejects a selection with no level", () => {
    const problem = categorySelectionProblem(["grammar"], found("grammar"), true);

    expect(problem?.message).toBe("Pick at least one JLPT level.");
    expect(problem?.details).toMatchObject({ missingGroups: ["level"] });
  });

  it("rejects a selection with no skill", () => {
    const problem = categorySelectionProblem(["n5"], found("n5"), true);

    expect(problem?.message).toBe("Pick at least one skill.");
  });

  it("rejects a selection that is only an unrequired group", () => {
    // The case the old silent-filter code let through: `genre` is a real slug,
    // so the lookup returned a row and the insert succeeded, and the book was
    // filed where no storefront facet looks.
    const problem = categorySelectionProblem(["fiction"], found("fiction"), true);

    expect(problem?.details).toMatchObject({ missingGroups: ["skill", "level"] });
  });

  it("names both groups when neither is covered", () => {
    const problem = categorySelectionProblem([], [], true);

    expect(problem?.message).toBe("Pick at least one skill and one JLPT level.");
    expect(problem?.details).toMatchObject({ missingGroups: [...REQUIRED_CATEGORY_GROUPS] });
  });

  it("rejects a slug that does not exist", () => {
    // "n05" for "n5" is the typo that matters: the level silently vanishes,
    // and a coverage check counting only returned rows would have passed it.
    const problem = categorySelectionProblem(["grammar", "n05"], found("grammar", "n05"), true);

    expect(problem?.message).toBe("Unknown category: n05.");
    expect(problem?.details).toMatchObject({ unknown: ["n05"] });
  });

  it("pluralises when several slugs are unknown", () => {
    const problem = categorySelectionProblem(["nope", "also-nope"], [], true);

    expect(problem?.message).toBe("Unknown categories: nope, also-nope.");
  });

  it("reports an unknown slug ahead of a missing group", () => {
    // Told "pick a JLPT level" while looking at a level they thought they had
    // typed, an operator has no way to find the mistake. The typo comes first.
    const problem = categorySelectionProblem(["n05"], [], true);

    expect(problem?.details).toHaveProperty("unknown");
    expect(problem?.details).not.toHaveProperty("missingGroups");
  });

  it("still rejects an unknown slug when coverage is not required", () => {
    // A PATCH sending categories is not held to the skill/level rule — books
    // predating it must stay editable — but a typo is a typo either way.
    const problem = categorySelectionProblem(["n05"], [], false);

    expect(problem?.details).toMatchObject({ unknown: ["n05"] });
  });

  it("allows an incomplete selection when coverage is not required", () => {
    expect(categorySelectionProblem(["grammar"], found("grammar"), false)).toBeNull();
  });

  it("allows an empty selection when coverage is not required", () => {
    // How a PATCH that changes only the authors reaches the junction-table
    // rewrite: the existing categories are carried over, whatever they are.
    expect(categorySelectionProblem([], [], false)).toBeNull();
  });
});
