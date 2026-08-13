import { relations } from "drizzle-orm";
import { pgTable, text, uuid, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "../timestamps";
import { bookAuthors } from "./book-author";

export const authors = pgTable("authors", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  name: text("name").notNull(),
  bio: text("bio"),
  photoUrl: text("photo_url"),

  ...timestamps,
});

export const authorsRelations = relations(authors, ({ many }) => ({
  books: many(bookAuthors),
}));
