import { z } from "zod";
import { bookAvailabilityValues } from "./catalog";
import { pageQuerySchema, paginated } from "./pagination";

/* --------------------------------------------------------------------------
   Admin book management.

   Genuinely new ground — there was no admin-facing catalog surface before
   this. The storefront's book.mapper.ts deliberately hides `sku`,
   `lowStockThreshold`, `unitsSold`, `metaTitle` and `metaDescription` from a
   customer; the admin detail schema below is where those become visible,
   because editing them is the entire point of this surface.
   -------------------------------------------------------------------------- */

export const adminBookSortSchema = z
  .enum(["recent", "title", "price-asc", "stock-asc"])
  .default("recent");

export const adminBookQuerySchema = pageQuerySchema({ defaultPageSize: 20 }).extend({
  q: z.string().trim().min(1).optional(),
  isActive: z.coerce.boolean().optional(),
  isFeatured: z.coerce.boolean().optional(),
  availability: z.enum(bookAvailabilityValues).optional(),
  sort: adminBookSortSchema,
});

export type AdminBookQuery = z.infer<typeof adminBookQuerySchema>;

export const adminBookSummarySchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  title: z.string(),
  authors: z.array(z.string()),
  coverImageUrl: z.string(),
  priceCents: z.number().int().nonnegative(),
  compareAtPriceCents: z.number().int().nonnegative().nullable(),
  stockQuantity: z.number().int(),
  lowStockThreshold: z.number().int(),
  unitsSold: z.number().int().nonnegative(),
  isActive: z.boolean(),
  isFeatured: z.boolean(),
  availability: z.enum(bookAvailabilityValues),
});

export type AdminBookSummary = z.infer<typeof adminBookSummarySchema>;

export const adminBookListSchema = paginated(adminBookSummarySchema);
export type AdminBookList = z.infer<typeof adminBookListSchema>;

export const adminBookDetailSchema = adminBookSummarySchema.extend({
  subtitle: z.string().nullable(),
  isbn10: z.string().nullable(),
  isbn13: z.string().nullable(),
  publisherName: z.string().nullable(),
  publishedDate: z.string().datetime().nullable(),
  edition: z.string().nullable(),
  language: z.string(),
  description: z.string(),
  pageCount: z.number().int().nullable(),
  sku: z.string().nullable(),
  weightGrams: z.number().int().nullable(),
  coverImageAlt: z.string().nullable(),
  galleryImageUrls: z.array(z.string()),
  /** A sample/preview PDF — a few chapters, not the full manuscript. */
  pdfUrl: z.string().nullable(),
  pdfFileName: z.string().nullable(),
  metaTitle: z.string().nullable(),
  metaDescription: z.string().nullable(),
  authorNames: z.array(z.string()),
  categorySlugs: z.array(z.string()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type AdminBookDetail = z.infer<typeof adminBookDetailSchema>;

/**
 * Every column the create form can set, plus the relations expressed the way
 * a small shop actually manages them:
 *
 * - `authorNames`/`publisherName` are find-or-create by name — a shop adds
 *   authors and publishers constantly and does not need a separate "manage
 *   authors" screen for it.
 * - `categorySlugs` selects from the *existing* taxonomy only (categories are
 *   seeded reference data — "the shop's whole vocabulary", per
 *   categories.controller.ts — not admin-creatable here).
 */
/**
 * No `.default()` on any field here, deliberately — `.default()` fires during
 * parsing regardless of whether the object is later wrapped in `.partial()`,
 * so a field with one would come out of `adminBookUpdateRequestSchema` as its
 * default value rather than `undefined` on every PATCH that omits it, and
 * `admin-books.service.ts`'s `updateColumns()` (which treats "present" as
 * "change this column") would overwrite the real value with the default on
 * every partial update. Defaults are applied once, explicitly, in
 * `adminBookCreateRequestSchema`'s `.transform()` below — the one place they
 * are actually wanted.
 */
const adminBookFieldsSchema = z.object({
  title: z.string().trim().min(1, "Title is required."),
  subtitle: z.string().trim().optional(),
  isbn10: z.string().trim().optional(),
  isbn13: z.string().trim().optional(),
  /**
   * Required, unlike the nullable `books.publisher_id` it resolves to. The
   * column stays nullable because rows written before this rule existed have
   * no publisher and must stay editable; requiring it on the way *in* is what
   * stops the gap growing.
   */
  publisherName: z.string().trim().min(1, "Publisher is required."),
  publishedDate: z.string().date().optional(),
  edition: z.string().trim().optional(),
  language: z.string().trim().min(1).optional(),

  description: z.string().trim().min(1, "Description is required."),
  pageCount: z.number().int().positive().optional(),

  priceCents: z.number().int().nonnegative(),
  compareAtPriceCents: z.number().int().nonnegative().optional(),
  sku: z.string().trim().optional(),

  stockQuantity: z.number().int().nonnegative().optional(),
  lowStockThreshold: z.number().int().nonnegative().optional(),
  weightGrams: z.number().int().positive().optional(),

  /**
   * `in_stock` unless set. `pre_order` is a normal catalog book that ships
   * later — same cart, same checkout — not the retired pre-order stream.
   * `coming_soon` must carry zero stock; see `aboveCompareAtPrice`'s sibling
   * refine below.
   */
  availability: z.enum(bookAvailabilityValues).optional(),

  coverImageUrl: z.string().trim().min(1, "Add a cover image."),
  coverImageAlt: z.string().trim().optional(),
  galleryImageUrls: z.array(z.string()).optional(),

  pdfUrl: z.string().trim().optional(),
  pdfFileName: z.string().trim().optional(),

  isActive: z.boolean().optional(),
  isFeatured: z.boolean().optional(),

  metaTitle: z.string().trim().optional(),
  metaDescription: z.string().trim().optional(),

  authorNames: z.array(z.string().trim().min(1)).min(1, "Add at least one author."),

  /**
   * Required, and required to cover two specific groups: at least one `skill`
   * and at least one `level`. Only the non-empty half of that is expressible
   * here — which group a slug belongs to is a row in `categories`, not a fact
   * this package can see — so the coverage rule is enforced in
   * `admin-books.service.ts`, where the taxonomy is in reach. See
   * `assertCategoryCoverage` there.
   */
  categorySlugs: z.array(z.string()).min(1, "Pick a skill and a JLPT level."),

  /** Auto-generated from the title when omitted — see admin-books.service.ts. */
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase words separated by hyphens.")
    .optional(),
});

/** Shared by create and update — a compare-at price only means anything above the price itself. */
function aboveCompareAtPrice<T extends { priceCents?: number; compareAtPriceCents?: number }>(
  value: T,
): boolean {
  return (
    value.compareAtPriceCents === undefined ||
    value.priceCents === undefined ||
    value.compareAtPriceCents > value.priceCents
  );
}

/**
 * A `coming_soon` row is never orderable, and a stock count on one would be a
 * standing lie — either checkout would sell against it (contradicting "not
 * released yet") or the shop would carry stock that inventory can never move.
 * Only fires when both fields are actually present in the request: a PATCH
 * that only changes, say, the price must not fail because it didn't also
 * repeat `stockQuantity: 0`.
 */
function comingSoonHasNoStock<T extends { availability?: string; stockQuantity?: number }>(
  value: T,
): boolean {
  return !(value.availability === "coming_soon" && (value.stockQuantity ?? 0) > 0);
}

export const adminBookCreateRequestSchema = adminBookFieldsSchema
  .refine(aboveCompareAtPrice, {
    message: "Compare-at price must be higher than the price.",
    path: ["compareAtPriceCents"],
  })
  .refine(comingSoonHasNoStock, {
    message: "A coming-soon book must have zero stock.",
    path: ["stockQuantity"],
  })
  /**
   * Defaults applied here, once, after validation — not with `.default()` on
   * the shared fields above. See the comment on `adminBookFieldsSchema`.
   */
  .transform((value) => ({
    ...value,
    language: value.language ?? "en",
    stockQuantity: value.stockQuantity ?? 0,
    lowStockThreshold: value.lowStockThreshold ?? 5,
    galleryImageUrls: value.galleryImageUrls ?? [],
    isActive: value.isActive ?? true,
    isFeatured: value.isFeatured ?? false,
    availability: value.availability ?? "in_stock",
  }));

export type AdminBookCreateRequest = z.infer<typeof adminBookCreateRequestSchema>;

/**
 * What a caller *sends*, as opposed to what the schema hands back.
 *
 * `adminBookCreateRequestSchema` ends in a `.transform()` that fills in
 * `language`, `stockQuantity`, `lowStockThreshold`, `availability`,
 * `galleryImageUrls`, `isActive` and `isFeatured`, so `AdminBookCreateRequest`
 * — the output — has all seven as required. A form building the payload has
 * not been through the transform yet and must be allowed to omit them; typing
 * it against the output makes every optional field look mandatory and forces
 * the form to invent the very defaults the schema exists to apply.
 */
export type AdminBookCreateInput = z.input<typeof adminBookCreateRequestSchema>;

/**
 * Everything except `slug`, which cannot move once a book exists — the same
 * rule as `adminRegionUpdateSchema`, for the same reason: it is what a
 * customer's link and browser history point at.
 */
export const adminBookUpdateRequestSchema = adminBookFieldsSchema
  .omit({ slug: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "Change at least one field." })
  .refine(aboveCompareAtPrice, {
    message: "Compare-at price must be higher than the price.",
    path: ["compareAtPriceCents"],
  })
  .refine(comingSoonHasNoStock, {
    message: "A coming-soon book must have zero stock.",
    path: ["stockQuantity"],
  });

export type AdminBookUpdateRequest = z.infer<typeof adminBookUpdateRequestSchema>;

/** The pre-parse shape, for the same reason as `AdminBookCreateInput`. */
export type AdminBookUpdateInput = z.input<typeof adminBookUpdateRequestSchema>;

/* --------------------------------------------------------------------------
   Uploads
   -------------------------------------------------------------------------- */

export const adminUploadResultSchema = z.object({
  url: z.string(),
  fileName: z.string().optional(),
});

export type AdminUploadResult = z.infer<typeof adminUploadResultSchema>;
