import { relations } from "drizzle-orm";
import { integer, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "../timestamps";
import { bookCategories } from "./book-category";

export const categories = pgTable("categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),

  // "level" | "skill" | "format" | "collection" — lets UI render separate filter sections
  group: varchar("group", { length: 50 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),

  // UX NOTE: a book can hold multiple Level categories (e.g. N1-N5 comprehensive,
  // or N2-N4 only, even non-contiguous). Don't store a level range on books —
  // compute it for DISPLAY ONLY at read time (min/max among the book's assigned
  // level categories, ordered by sortOrder) so a badge can show "N1-N5" instead
  // of listing every level tag separately. Never persist the computed range.

  ...timestamps,
});

export const categoriesRelations = relations(categories, ({ many }) => ({
  books: many(bookCategories),
}));
