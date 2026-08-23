import { describe, expect, it } from "vitest";
import {
  adminBookCreateRequestSchema,
  adminBookUpdateRequestSchema,
} from "@sakura/contracts";

/**
 * What the admin create form must supply, and what it may leave out.
 *
 * The mandatory set is a product decision — title, description, author,
 * publisher, price, cover, plus a skill and a JLPT level — and the point of
 * these tests is that adding a field to the form cannot quietly make it
 * required, nor a refactor quietly make one of the eight optional. Both
 * failures look like a working form until someone tries to save a book.
 *
 * The skill/level half of the rule is not here: which group a slug belongs to
 * is a row in `categories`, so it is enforced in `admin-books.service.ts` and
 * all this schema can check is that the array is not empty.
 */

/** Exactly the mandatory fields, nothing else. */
function minimalBook() {
  return {
    title: "JLPT N3 Kanji Drills",
    description: "Two hundred kanji, drilled.",
    authorNames: ["Sakura Editorial Team"],
    publisherName: "Nihonova Press",
    priceCents: 1200,
    coverImageUrl: "https://example.com/cover.jpg",
    categorySlugs: ["kanji", "n3"],
  };
}

describe("adminBookCreateRequestSchema", () => {
  it("accepts a book carrying only the mandatory fields", () => {
    const result = adminBookCreateRequestSchema.safeParse(minimalBook());

    expect(result.success).toBe(true);
  });

  it("fills in the columns the form is allowed to omit", () => {
    // These are the defaults the DB would also apply. They are asserted here
    // because the form no longer sends them: if the transform stopped
    // supplying `stockQuantity`, the request would post `undefined` and the
    // book would be created with whatever the column default happened to be —
    // which is the same value today and need not stay that way.
    const parsed = adminBookCreateRequestSchema.parse(minimalBook());

    expect(parsed).toMatchObject({
      language: "en",
      stockQuantity: 0,
      lowStockThreshold: 5,
      availability: "in_stock",
      galleryImageUrls: [],
      isActive: true,
      isFeatured: false,
    });
  });

  it.each([
    "title",
    "description",
    "authorNames",
    "publisherName",
    "priceCents",
    "coverImageUrl",
    "categorySlugs",
  ] as const)("rejects a book with no %s", (field) => {
    const { [field]: _omitted, ...rest } = minimalBook();

    expect(adminBookCreateRequestSchema.safeParse(rest).success).toBe(false);
  });

  it.each([
    ["subtitle", { subtitle: "Volume two" }],
    ["isbn13", { isbn13: "9781234567897" }],
    ["publishedDate", { publishedDate: "2026-01-31" }],
    ["pageCount", { pageCount: 240 }],
    ["sku", { sku: "NB-N3-KANJI" }],
    ["stockQuantity", { stockQuantity: 40 }],
    ["lowStockThreshold", { lowStockThreshold: 2 }],
    ["weightGrams", { weightGrams: 350 }],
    ["compareAtPriceCents", { compareAtPriceCents: 1800 }],
    ["coverImageAlt", { coverImageAlt: "A cover" }],
    ["pdfUrl", { pdfUrl: "https://example.com/sample.pdf" }],
    ["metaTitle", { metaTitle: "Kanji drills" }],
    ["galleryImageUrls", { galleryImageUrls: ["https://example.com/1.jpg"] }],
  ])("still accepts the book when the optional %s is supplied", (_label, extra) => {
    const result = adminBookCreateRequestSchema.safeParse({ ...minimalBook(), ...extra });

    expect(result.success).toBe(true);
  });

  it("rejects a blank publisher rather than treating it as absent", () => {
    // `.trim().min(1)` and not merely `.min(1)`: an input the operator typed a
    // space into must fail the same way an empty one does, or the book is
    // filed under a publisher named " ".
    expect(
      adminBookCreateRequestSchema.safeParse({ ...minimalBook(), publisherName: "   " }).success,
    ).toBe(false);
  });

  it("rejects an empty category list", () => {
    expect(
      adminBookCreateRequestSchema.safeParse({ ...minimalBook(), categorySlugs: [] }).success,
    ).toBe(false);
  });
});

describe("adminBookUpdateRequestSchema", () => {
  it("accepts a patch that changes one field and mentions nothing else", () => {
    // The whole point of the update schema being `.partial()`. A create-shaped
    // requirement leaking into it would mean renaming a book required
    // re-sending its publisher and categories — and would make the one
    // existing book with no JLPT level uneditable.
    const result = adminBookUpdateRequestSchema.safeParse({ title: "A new title" });

    expect(result.success).toBe(true);
  });

  it("still rejects a blank publisher when the patch does mention it", () => {
    expect(adminBookUpdateRequestSchema.safeParse({ publisherName: "" }).success).toBe(false);
  });

  it("still rejects an emptied category list when the patch does mention it", () => {
    expect(adminBookUpdateRequestSchema.safeParse({ categorySlugs: [] }).success).toBe(false);
  });
});
