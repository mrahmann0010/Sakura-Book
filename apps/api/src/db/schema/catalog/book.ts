import { relations } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { orderItems } from "../orders/order-item";
import { timestamps } from "../timestamps";
import { bookAuthors } from "./book-author";
import { bookCategories } from "./book-category";
import { publishers } from "./publisher";

export const books = pgTable("books", {
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

  isActive: boolean("is_active").notNull().default(true),
  isFeatured: boolean("is_featured").notNull().default(false),

  metaTitle: text("meta_title"),
  metaDescription: text("meta_description"),

  ...timestamps,
});

export const booksRelations = relations(books, ({ one, many }) => ({
  publisher: one(publishers, {
    fields: [books.publisherId],
    references: [publishers.id],
  }),
  authors: many(bookAuthors),
  categories: many(bookCategories),
  orderItems: many(orderItems),
}));
