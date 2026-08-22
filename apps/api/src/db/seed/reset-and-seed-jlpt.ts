import { drizzle } from "drizzle-orm/postgres-js";
import { join } from "node:path";
import postgres from "postgres";
import * as schema from "../schema";
import { slugify } from "../../common/slugify";
import { seedReference } from "./reference";
import {
  bookAuthors,
  bookCategories,
  books,
  authors,
  categories,
  coupons,
  orderItems,
  orderStatusHistory,
  orders,
  payments,
  preOrderBooks,
  preOrderOrders,
  publishers,
} from "../schema";

/**
 * One-off dev utility: wipes the commerce/catalog data (not admin accounts or
 * shop settings) and reseeds it with a minimal JLPT-themed placeholder shelf —
 * one pre-order title and five "coming soon" titles, all as normal catalog
 * books (see `books.availability`) — so the storefront and admin panel have
 * something real to render locally.
 *
 * The separate pre-order stream (`pre_order_books` / `pre_order_orders`) is
 * retired from the frontend; this seed only clears those tables for hygiene
 * and never inserts into them. Every title here goes through the one normal
 * book/cart/checkout flow.
 *
 * Not wired into `npm run db:seed`. Run directly:
 *   npx tsx src/db/seed/reset-and-seed-jlpt.ts
 */
async function main(): Promise<void> {
  process.loadEnvFile(join(__dirname, "..", "..", "..", ".env"));

  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set — check apps/api/.env.");

  const client = postgres(url, {
    max: 1,
    ssl: process.env.DATABASE_SSL === "disable" ? false : "require",
    prepare: false,
  });
  const db = drizzle(client, { schema });

  try {
    console.log("Clearing catalog / commerce placeholder data...");

    // Child tables first, respecting FKs. Admin users/sessions, audit log and
    // shop settings are deliberately untouched — those aren't the placeholder
    // catalog data this was asked to clear. pre_order_orders/pre_order_books
    // are cleared too even though nothing below repopulates them — the
    // separate pre-order stream is retired from the frontend.
    await db.delete(orderStatusHistory);
    await db.delete(payments);
    await db.delete(orderItems);
    await db.delete(orders);
    await db.delete(preOrderOrders);
    await db.delete(preOrderBooks);
    await db.delete(bookCategories);
    await db.delete(bookAuthors);
    await db.delete(books);
    await db.delete(authors);
    await db.delete(publishers);
    await db.delete(coupons);

    console.log("Cleared.");

    await seedReference(db);

    // JLPT level/skill facets, additive to the existing genre categories.
    await db
      .insert(categories)
      .values([
        { slug: "n5", name: "N5", group: "level", sortOrder: 1 },
        { slug: "n4", name: "N4", group: "level", sortOrder: 2 },
        { slug: "n3", name: "N3", group: "level", sortOrder: 3 },
        { slug: "n2", name: "N2", group: "level", sortOrder: 4 },
        { slug: "n1", name: "N1", group: "level", sortOrder: 5 },
        { slug: "grammar", name: "Grammar", group: "skill", sortOrder: 1 },
        { slug: "kanji", name: "Kanji", group: "skill", sortOrder: 2 },
        { slug: "vocabulary", name: "Vocabulary", group: "skill", sortOrder: 3 },
        { slug: "reading", name: "Reading", group: "skill", sortOrder: 4 },
        { slug: "listening", name: "Listening", group: "skill", sortOrder: 5 },
      ])
      .onConflictDoNothing({ target: categories.slug });

    const [publisher] = await db
      .insert(publishers)
      .values({ slug: "sakura-jlpt-press", name: "Sakura JLPT Press" })
      .returning({ id: publishers.id });

    const authorName = "Sakura Editorial Team";
    const [author] = await db
      .insert(authors)
      .values({ slug: slugify(authorName), name: authorName })
      .returning({ id: authors.id });

    const categoryIds = new Map(
      (await db.query.categories.findMany({ columns: { id: true, slug: true } })).map((row) => [
        row.slug,
        row.id,
      ]),
    );

    async function insertBook(sample: {
      slug: string;
      title: string;
      priceCents: number;
      coverImageUrl: string;
      description: string;
      categorySlugs: string[];
      stockQuantity: number;
      availability: "coming_soon" | "pre_order";
      publishedDate?: Date;
    }): Promise<void> {
      const [inserted] = await db
        .insert(books)
        .values({
          slug: sample.slug,
          title: sample.title,
          description: sample.description,
          priceCents: sample.priceCents,
          stockQuantity: sample.stockQuantity,
          availability: sample.availability,
          publishedDate: sample.publishedDate ?? null,
          publisherId: publisher.id,
          coverImageUrl: sample.coverImageUrl,
          coverImageAlt: `Cover of ${sample.title}`,
        })
        .returning({ id: books.id });

      if (!inserted) return;

      await db.insert(bookAuthors).values({ bookId: inserted.id, authorId: author.id });

      const categoryIdsForBook = sample.categorySlugs
        .map((slug) => categoryIds.get(slug))
        .filter((id): id is string => Boolean(id));

      if (categoryIdsForBook.length > 0) {
        await db
          .insert(bookCategories)
          .values(categoryIdsForBook.map((categoryId) => ({ bookId: inserted.id, categoryId })));
      }
    }

    console.log("Seeding pre-order book...");

    // Buyable today through the normal cart/checkout, ships later. Real stock
    // (the print run size) rather than unlimited — checkout blocks once it
    // hits zero, same guarded decrement as any other title.
    await insertBook({
      slug: "jlpt-n5-grammar-foundations",
      title: "JLPT N5 Grammar Foundations",
      priceCents: 1200,
      coverImageUrl: "https://picsum.photos/seed/jlpt-n5-grammar/600/900",
      description:
        "Placeholder copy. A beginner-friendly walkthrough of every N5 grammar point, with example sentences and practice drills.",
      categorySlugs: ["n5", "grammar"],
      stockQuantity: 150,
      availability: "pre_order",
      // Expected release — the "ships around" note reads off this.
      publishedDate: new Date(Date.UTC(2026, 10, 1)),
    });

    console.log("Seeding 5 coming-soon catalog books...");

    for (const sample of COMING_SOON_BOOKS) {
      await insertBook({
        ...sample,
        stockQuantity: 0, // "coming soon": listed, never orderable
        availability: "coming_soon",
      });
    }

    console.log("Done: 1 pre-order book + 5 coming-soon books seeded, all as normal catalog books.");
  } finally {
    await client.end();
  }
}

const COMING_SOON_BOOKS = [
  {
    slug: "jlpt-n4-kanji-mastery",
    title: "JLPT N4 Kanji Mastery",
    priceCents: 1350,
    coverImageUrl: "https://picsum.photos/seed/jlpt-n4-kanji/600/900",
    description: "Placeholder copy. All N4 kanji with stroke order, readings, and example words.",
    categorySlugs: ["n4", "kanji"],
  },
  {
    slug: "jlpt-n3-vocabulary-builder",
    title: "JLPT N3 Vocabulary Builder",
    priceCents: 1250,
    coverImageUrl: "https://picsum.photos/seed/jlpt-n3-vocab/600/900",
    description: "Placeholder copy. Core N3 vocabulary organized by theme, with example sentences.",
    categorySlugs: ["n3", "vocabulary"],
  },
  {
    slug: "jlpt-n2-reading-comprehension",
    title: "JLPT N2 Reading Comprehension",
    priceCents: 1450,
    coverImageUrl: "https://picsum.photos/seed/jlpt-n2-reading/600/900",
    description: "Placeholder copy. Timed reading passages and strategy notes for the N2 reading section.",
    categorySlugs: ["n2", "reading"],
  },
  {
    slug: "jlpt-n1-listening-practice",
    title: "JLPT N1 Listening Practice",
    priceCents: 1600,
    coverImageUrl: "https://picsum.photos/seed/jlpt-n1-listening/600/900",
    description: "Placeholder copy. Full-length N1 listening drills with transcripts and audio cues.",
    categorySlugs: ["n1", "listening"],
  },
  {
    slug: "complete-jlpt-grammar-reference",
    title: "Complete JLPT Grammar Reference N5-N1",
    priceCents: 2200,
    coverImageUrl: "https://picsum.photos/seed/jlpt-grammar-complete/600/900",
    description: "Placeholder copy. Every JLPT grammar point from N5 through N1 in one reference volume.",
    categorySlugs: ["grammar"],
  },
];

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
