import { describe, expect, it } from "vitest";
import { REVIEW_BODY_MIN, reviewSubmitRequestSchema } from "@sakura/contracts";
import { toReview } from "../../src/reviews/review.mapper";

/**
 * What a visitor may send, and what comes back out.
 *
 * Two things are being protected here, and both fail silently if they break.
 * The first is that the form stays answerable: everything except the review
 * text is optional by product decision, and a refactor quietly making the name
 * or the rating required looks like a working form until someone tries to
 * submit one. The second is that the moderation gate is not reachable from the
 * request shape — a schema that starts accepting `status` publishes the queue.
 */

const sentence = "The N4 grammar explanations are clearer than anything else I have used.";

describe("reviewSubmitRequestSchema", () => {
  it("accepts a body and nothing else", () => {
    // The whole point of the form: someone willing to write two sentences is
    // not turned away for declining to type their name.
    const result = reviewSubmitRequestSchema.safeParse({ body: sentence });

    expect(result.success).toBe(true);
  });

  it("rejects a body too short to be worth publishing", () => {
    // The floor is what stops the queue filling with "good" and "nice service",
    // which are indistinguishable from spam and add nothing to a page.
    const result = reviewSubmitRequestSchema.safeParse({ body: "nice" });

    expect(result.success).toBe(false);
  });

  it("counts the trimmed body against the minimum", () => {
    // Otherwise padding with spaces clears the floor the previous test sets.
    const padded = `${" ".repeat(50)}nice${" ".repeat(50)}`;

    expect(reviewSubmitRequestSchema.safeParse({ body: padded }).success).toBe(false);
    expect("nice".length).toBeLessThan(REVIEW_BODY_MIN);
  });

  it("requires a body at all", () => {
    expect(reviewSubmitRequestSchema.safeParse({ authorName: "Rahim" }).success).toBe(false);
  });

  it("keeps every other field optional", () => {
    for (const field of ["authorName", "authorEmail", "rating", "title"] as const) {
      const parsed = reviewSubmitRequestSchema.safeParse({ body: sentence });

      expect(parsed.success, `${field} must not be required`).toBe(true);
    }
  });

  it("holds the rating to whole stars in range", () => {
    for (const rating of [0, 6, 3.5, -1]) {
      expect(reviewSubmitRequestSchema.safeParse({ body: sentence, rating }).success).toBe(false);
    }

    expect(reviewSubmitRequestSchema.safeParse({ body: sentence, rating: 5 }).success).toBe(true);
  });

  it("strips the moderation fields rather than honouring them", () => {
    // The gate this protects: nothing a visitor posts may arrive approved,
    // featured or verified. Zod drops unknown keys, and the global pipe runs
    // with `whitelist` — this asserts the schema half of that.
    const parsed = reviewSubmitRequestSchema.parse({
      body: sentence,
      status: "APPROVED",
      isFeatured: true,
      isVerified: true,
      publishedAt: new Date().toISOString(),
    });

    expect(parsed).not.toHaveProperty("status");
    expect(parsed).not.toHaveProperty("isFeatured");
    expect(parsed).not.toHaveProperty("isVerified");
    expect(parsed).not.toHaveProperty("publishedAt");
  });

  it("refuses a filled honeypot", () => {
    // A real browser never fills a hidden field. The server drops it silently
    // in production; the contract failing here is what keeps it obvious in
    // development that the trap is still wired up.
    const result = reviewSubmitRequestSchema.safeParse({ body: sentence, website: "spam.example" });

    expect(result.success).toBe(false);
  });

  it("has no book field at all", () => {
    // These are about the service. A `bookId` that parses would be the first
    // step towards this table meaning two things, which is the split the
    // design exists to avoid.
    const parsed = reviewSubmitRequestSchema.parse({
      body: sentence,
      bookId: "11111111-1111-4111-8111-111111111111",
    });

    expect(parsed).not.toHaveProperty("bookId");
  });
});

describe("toReview", () => {
  const row = {
    id: "11111111-1111-4111-8111-111111111111",
    authorName: "Rahim",
    rating: 5,
    title: null,
    body: sentence,
    isVerified: false,
    publishedAt: new Date("2026-08-01T00:00:00.000Z"),
  };

  it("never carries a field the public shape has no place for", () => {
    // The mapper is the enforcement point for `author_email` and `ip_hash`.
    // Spreading the row instead of listing the fields is the mistake this
    // catches, and it is one nobody notices until the email is on a page.
    const mapped = toReview({ ...row, authorEmail: "rahim@example.com" } as never);

    expect(mapped).not.toHaveProperty("authorEmail");
    expect(mapped).not.toHaveProperty("ipHash");
    expect(mapped).not.toHaveProperty("moderatorNote");
    expect(Object.keys(mapped).sort()).toEqual(
      ["authorName", "body", "id", "isVerified", "publishedAt", "rating", "title"].sort(),
    );
  });

  it("leaves an absent name null for the client to render", () => {
    // Not defaulted to "Anonymous" here: three locales render this string, and
    // "Anonymous" is not the same word in all of them.
    expect(toReview({ ...row, authorName: null }).authorName).toBeNull();
  });

  it("dates a review by its approval, not its submission", () => {
    expect(toReview(row).publishedAt).toBe("2026-08-01T00:00:00.000Z");
  });
});
