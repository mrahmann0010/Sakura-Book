import { relations } from "drizzle-orm";
import { integer, pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { bookAuthorRoleEnum } from "../enums";
import { authors } from "./author";
import { books } from "./book";

export const bookAuthors = pgTable(
  "book_authors",
  {
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id),
    authorId: uuid("author_id")
      .notNull()
      .references(() => authors.id),
    role: bookAuthorRoleEnum("role").notNull().default("AUTHOR"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.bookId, table.authorId] })],
);

export const bookAuthorsRelations = relations(bookAuthors, ({ one }) => ({
  book: one(books, { fields: [bookAuthors.bookId], references: [books.id] }),
  author: one(authors, { fields: [bookAuthors.authorId], references: [authors.id] }),
}));
