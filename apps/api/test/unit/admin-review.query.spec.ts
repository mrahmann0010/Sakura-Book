import { describe, expect, it } from "vitest";
import { adminReviewQuerySchema, adminReviewUpdateRequestSchema } from "@sakura/contracts";
import { adminReviewFilters, adminReviewOrder } from "../../src/admin/reviews/admin-reviews.query";

/**
 * The moderation queue's filters and sort.
 *
 * Same class of bug as the catalog's and the waitlist's: a missing tiebreak
 * produces a queue that looks fine and quietly skips a row, which here means a
 * real customer's testimonial that is never moderated because it was never
 * seen.
 */

function query(overrides: Record<string, unknown> = {}) {
  return adminReviewQuerySchema.parse(overrides);
}

describe("adminReviewOrder", () => {
  it("always ends in a stable tiebreak", () => {
    for (const sort of ["recent", "oldest", "rating-desc", "rating-asc"] as const) {
      expect(adminReviewOrder(sort).length, sort).toBeGreaterThanOrEqual(2);
    }
  });

  it("falls back to the default ordering for an unknown sort", () => {
    expect(adminReviewOrder("nonsense" as never)).toHaveLength(adminReviewOrder("recent").length);
  });
});

describe("adminReviewFilters", () => {
  it("filters nothing when nothing was asked for", () => {
    // `undefined` rather than an always-true fragment: Drizzle takes the
    // absence of a `where` and an empty `and()` differently, and the latter
    // has produced a syntax error in this codebase's shape of query before.
    expect(adminReviewFilters(query())).toBeUndefined();
  });

  it("builds a condition once a filter is named", () => {
    expect(adminReviewFilters(query({ status: "PENDING" }))).toBeDefined();
    expect(adminReviewFilters(query({ q: "courier" }))).toBeDefined();
    expect(adminReviewFilters(query({ isFeatured: true }))).toBeDefined();
  });

  it("drops the status condition for the tab counts and keeps the rest", () => {
    // The counts are this query minus one condition. If `skipStatus` ever
    // stopped working, the tabs would each report their own count and the
    // numbers would agree with nothing.
    const filters = query({ status: "PENDING" });

    expect(adminReviewFilters(filters, { skipStatus: true })).toBeUndefined();
    expect(adminReviewFilters({ ...filters, q: "courier" }, { skipStatus: true })).toBeDefined();
  });

  it("accepts a repeated status the way it arrives over HTTP", () => {
    // One occurrence arrives as a string, two as an array.
    expect(query({ status: "PENDING" }).status).toEqual(["PENDING"]);
    expect(query({ status: ["PENDING", "SPAM"] }).status).toEqual(["PENDING", "SPAM"]);
  });

  it("defaults to the newest submissions first", () => {
    // A work queue, unlike the waitlist, which is a fair one.
    expect(query().sort).toBe("recent");
  });
});

describe("adminReviewUpdateRequestSchema", () => {
  it("refuses an update that changes nothing", () => {
    expect(adminReviewUpdateRequestSchema.safeParse({}).success).toBe(false);
  });

  it("distinguishes clearing the order link from leaving it alone", () => {
    // `null` clears it, absent leaves it. The service branches on `undefined`,
    // so the schema must preserve an explicit null.
    expect(adminReviewUpdateRequestSchema.parse({ orderNumber: null }).orderNumber).toBeNull();
    expect(
      adminReviewUpdateRequestSchema.parse({ status: "APPROVED" }).orderNumber,
    ).toBeUndefined();
  });

  it("has no book field to move a testimonial with", () => {
    const parsed = adminReviewUpdateRequestSchema.parse({ status: "APPROVED", bookId: null });

    expect(parsed).not.toHaveProperty("bookId");
  });

  it("does not let a moderator rewrite what someone said", () => {
    // Relocating a review or declining to publish it is moderation. Editing
    // the words and publishing the result under their name is not.
    const parsed = adminReviewUpdateRequestSchema.parse({
      status: "APPROVED",
      body: "actually I loved it",
      authorName: "Someone Else",
      title: "Rewritten",
    });

    expect(parsed).not.toHaveProperty("body");
    expect(parsed).not.toHaveProperty("authorName");
    expect(parsed).not.toHaveProperty("title");
  });

  it("does not let publishedAt be set by hand", () => {
    // It is derived from the status, because the table's check constraint
    // makes the two the same fact.
    expect(adminReviewUpdateRequestSchema.parse({ status: "APPROVED" })).not.toHaveProperty(
      "publishedAt",
    );
  });
});
