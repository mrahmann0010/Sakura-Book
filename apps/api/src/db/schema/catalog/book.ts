import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { orderItems } from "../orders/order-item";
import { timestamps } from "../timestamps";
import { bookAuthors } from "./book-author";
import { bookCategories } from "./book-category";
import { publishers } from "./publisher";

/**
 * Whether a title can be bought right now, and if not, why.
 *
 * `pre_order` is a normal catalog book — same cart, same checkout, same
 * payment — that ships later; it is not the separate pre-order stream (see
 * `db/schema/pre-order/*`), which was retired from the frontend. `stockQuantity`
 * still governs whether a `pre_order`/`in_stock` book can actually be added to
 * the cart (zero means sold out or none printed yet); `coming_soon` books are
 * never orderable regardless of stock — admin-books.service.ts enforces that a
 * `coming_soon` row always carries zero stock.
 */
export const bookAvailabilityEnum = pgEnum("book_availability", [
  "in_stock",
  "coming_soon",
  "pre_order",
]);

export const books = pgTable(
  "books",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: varchar("slug", { length: 255 }).notNull().unique(),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    isbn10: varchar("isbn_10", { length: 10 }).unique(),
    isbn13: varchar("isbn_13", { length: 13 }).unique(),

    publisherId: uuid("publisher_id").references(() => publishers.id),

    publishedDate: timestamp("published_date", { withTimezone: true }),
    edition: varchar("edition", { length: 100 }),
    language: varchar("language", { length: 20 }).notNull().default("en"),

    description: text("description").notNull(),
    pageCount: integer("page_count"),

    priceCents: integer("price_cents").notNull(),
    compareAtPriceCents: integer("compare_at_price_cents"),
    sku: varchar("sku", { length: 100 }).unique(),

    stockQuantity: integer("stock_quantity").notNull().default(0),
    lowStockThreshold: integer("low_stock_threshold").notNull().default(5),
    availability: bookAvailabilityEnum("availability").notNull().default("in_stock"),
    weightGrams: integer("weight_grams"),
    // {l, w, h} — captured now, unused until shipping model is decided
    dimensions: jsonb("dimensions").$type<{ l: number; w: number; h: number }>(),

    // Denormalized. Source of truth = orderItems + orderStatusHistory. Increment
    // async via event listener when an order hits PAYMENT_CONFIRMED, never inline
    // in checkout code. Run a periodic reconciliation job to correct drift.
    unitsSold: integer("units_sold").notNull().default(0),

    coverImageUrl: text("cover_image_url").notNull(),
    coverImageAlt: text("cover_image_alt"),
    galleryImageUrls: jsonb("gallery_image_urls").$type<string[]>(),

    // A sample/preview PDF the admin panel attaches — a few chapters, not the
    // full manuscript. Nullable: most rows will never have one, and unlike
    // coverImageUrl there is no storefront rule requiring it.
    pdfUrl: text("pdf_url"),
    // The uploaded file's original name, shown back in the admin panel next to
    // the preview — pdfUrl alone is a generated storage key, not a readable label.
    pdfFileName: text("pdf_file_name"),

    isActive: boolean("is_active").notNull().default(true),
    isFeatured: boolean("is_featured").notNull().default(false),

    /**
     * Whether /notify offers this title as something to wait on.
     *
     * Staff pick the list from the panel, which is the whole reason this is a
     * column rather than a constant: the page used to name one book by slug in
     * its own source, so changing which titles were on offer took a developer
     * and a deploy — on exactly the days (a reprint announced, a title selling
     * out) when the list most wants moving.
     *
     * Separate from `isFeatured` and from stock. A shop may well want to
     * collect names for a title that is *not* on the homepage, and it may not
     * want to collect them for every title that happens to be at zero — "which
     * books are worth waiting on" is an editorial decision, not one derivable
     * from the other flags. Defaults false: a newly added book is not silently
     * added to the waitlist page.
     */
    waitlistEnabled: boolean("waitlist_enabled").notNull().default(false),

    metaTitle: text("meta_title"),
    metaDescription: text("meta_description"),

    ...timestamps,
  },
  (table) => [
    /**
     * Trigram index for the catalog's free-text `q`, matched with ILIKE.
     *
     * GIN + pg_trgm rather than a tsvector column because the queries this has
     * to serve are partial words and misspelled titles typed into a search box
     * on a shelf of dozens of books — full-text search stems and tokenises,
     * which is the wrong tool for "murak" matching "Murakami". Revisit if the
     * catalog ever reaches thousands of titles.
     *
     * A plain btree index would not be used at all here: `ILIKE '%term%'` has
     * a leading wildcard, so there is no prefix to seek on.
     *
     * The operator class is schema-qualified because the database is Supabase,
     * which installs extensions into an `extensions` schema rather than
     * `public`. An unqualified `gin_trgm_ops` resolves through `search_path`,
     * which is set per role and is not something a migration should depend on
     * — the migration would then succeed or fail based on which role ran it.
     * Resolution happens once, at CREATE INDEX; queries never name the
     * operator class, so nothing at runtime depends on search_path either.
     */
    index("books_title_trgm_idx").using("gin", sql`${table.title} extensions.gin_trgm_ops`),
    // Browse lands on active books ordered by recency; this is that page's index.
    index("books_active_created_idx")
      .on(table.createdAt.desc())
      .where(sql`${table.isActive}`),
    index("books_publisher_idx").on(table.publisherId),
    /**
     * The /notify page's own read: the handful of titles staff have put on
     * offer, out of the whole catalog. Partial, because the rows that are *not*
     * on offer are the overwhelming majority and are never selected by it.
     */
    index("books_waitlist_enabled_idx")
      .on(table.title)
      .where(sql`${table.waitlistEnabled}`),
  ],
);

export const booksRelations = relations(books, ({ one, many }) => ({
  publisher: one(publishers, {
    fields: [books.publisherId],
    references: [publishers.id],
  }),
  authors: many(bookAuthors),
  categories: many(bookCategories),
  orderItems: many(orderItems),
}));
