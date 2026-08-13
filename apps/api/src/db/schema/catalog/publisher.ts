import { relations } from "drizzle-orm";
import { pgTable, text, uuid, varchar } from "drizzle-orm/pg-core";
import { timestamps } from "../timestamps";
import { books } from "./book";

export const publishers = pgTable("publishers", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  name: text("name").notNull(),
  logoUrl: text("logo_url"),
  websiteUrl: text("website_url"),

  ...timestamps,
});

export const publishersRelations = relations(publishers, ({ many }) => ({
  books: many(books),
}));
