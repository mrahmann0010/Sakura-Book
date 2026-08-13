import { relations } from "drizzle-orm";
import { pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { books } from "./book";
import { categories } from "./category";

export const bookCategories = pgTable(
  "book_categories",
  {
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
  },
  (table) => [primaryKey({ columns: [table.bookId, table.categoryId] })],
);

export const bookCategoriesRelations = relations(bookCategories, ({ one }) => ({
  book: one(books, { fields: [bookCategories.bookId], references: [books.id] }),
  category: one(categories, {
    fields: [bookCategories.categoryId],
    references: [categories.id],
  }),
}));
