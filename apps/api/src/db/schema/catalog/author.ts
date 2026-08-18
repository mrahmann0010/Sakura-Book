import { relations, sql } from "drizzle-orm";
import { index, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "../timestamps";
import { bookAuthors } from "./book-author";

export const authors = pgTable(
  "authors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: varchar("slug", { length: 255 }).notNull().unique(),
    name: text("name").notNull(),
    bio: text("bio"),
    photoUrl: text("photo_url"),

    ...timestamps,
  },
  // The catalog's `q` searches title *or* author name, so the author side needs
  // the same trigram treatment as books.title or half the query stays seq-scan.
  // Schema-qualified operator class — see the note on books.title's index.
  (table) => [
    index("authors_name_trgm_idx").using("gin", sql`${table.name} extensions.gin_trgm_ops`),
  ],
);

export const authorsRelations = relations(authors, ({ many }) => ({
  books: many(bookAuthors),
}));
