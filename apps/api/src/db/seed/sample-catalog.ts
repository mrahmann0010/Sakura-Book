import { eq } from "drizzle-orm";
import { slugify } from "../../common/slugify";
import type { Database } from "../db.types";
import { authors, bookAuthors, bookCategories, books, coupons, publishers } from "../schema";

/**
 * A development shelf, so a fresh database renders something.
 *
 * **This is placeholder data and must not be loaded into production.** The
 * titles are the nine from apps/web/src/lib/books.ts, which PRODUCT.md is
 * explicit about: real inventory exists and these are not it, so presenting
 * them as the shop's shelf would be showing a customer a catalog nobody chose.
 * `seed.ts` refuses to run this against a non-development NODE_ENV for that
 * reason.
 *
 * What is deliberately absent: reviews. The ratings on the placeholder cards
 * are invented numbers, and seeding them would put a fabricated 4.6-star
 * average onto a book — exactly the thing PRODUCT.md forbids showing as real.
 * The book_reviews table is created empty, every rating comes back null, and
 * the card renders its no-reviews state. That is the correct behaviour today,
 * not a gap in this file.
 *
 * Prices are the web app's cents figures reinterpreted as taka, not converted:
 * they were placeholder pounds, so 1400 becomes ৳1,400 rather than ৳14. There
 * is no exchange rate involved because there was never a real price here.
 */
export async function seedSampleCatalog(db: Database): Promise<void> {
  const [publisher] = await db
    .insert(publishers)
    .values({ slug: "sample-press", name: "Sample Press" })
    .onConflictDoNothing({ target: publishers.slug })
    .returning({ id: publishers.id });

  const publisherId =
    publisher?.id ??
    (await db.query.publishers.findFirst({
      where: eq(publishers.slug, "sample-press"),
      columns: { id: true },
    }))!.id;

  const authorRows = await db
    .insert(authors)
    .values(SAMPLE_AUTHORS.map((name) => ({ slug: slugify(name), name })))
    .onConflictDoNothing({ target: authors.slug })
    .returning({ id: authors.id, slug: authors.slug });

  // Re-read rather than trusting `returning`: on a re-run every row conflicts
  // and returns nothing, and the join tables below need ids either way.
  const authorIds = new Map(
    (authorRows.length === SAMPLE_AUTHORS.length
      ? authorRows
      : await db.query.authors.findMany({ columns: { id: true, slug: true } })
    ).map((row) => [row.slug, row.id]),
  );

  const categoryIds = new Map(
    (await db.query.categories.findMany({ columns: { id: true, slug: true } })).map((row) => [
      row.slug,
      row.id,
    ]),
  );

  for (const sample of SAMPLE_BOOKS) {
    const [inserted] = await db
      .insert(books)
      .values({
        slug: sample.slug,
        title: sample.title,
        description: sample.description,
        priceCents: sample.priceCents,
        stockQuantity: sample.stockQuantity,
        isFeatured: sample.isFeatured ?? false,
        publisherId,
        language: "en",
        coverImageUrl: `/covers/${sample.slug}.jpg`,
        coverImageAlt: `Cover of ${sample.title}`,
      })
      .onConflictDoNothing({ target: books.slug })
      .returning({ id: books.id });

    if (!inserted) continue; // already seeded

    const authorId = authorIds.get(slugify(sample.author));
    if (authorId) {
      await db.insert(bookAuthors).values({ bookId: inserted.id, authorId }).onConflictDoNothing();
    }

    const categoryId = categoryIds.get(sample.genre);
    if (categoryId) {
      await db
        .insert(bookCategories)
        .values({ bookId: inserted.id, categoryId })
        .onConflictDoNothing();
    }
  }

  /**
   * Two coupons, chosen to exercise both discount types and the guarded
   * redemption path — a percentage one and a fixed-amount one with a minimum
   * spend, so a developer can hit the "below minimum" rejection without
   * editing the database by hand.
   */
  await db
    .insert(coupons)
    .values([
      {
        code: "SAKURA10",
        discountType: "PERCENTAGE" as const,
        discountValue: 10,
        isActive: true,
      },
      {
        code: "TAKA200",
        discountType: "FIXED_AMOUNT" as const,
        discountValue: 20000,
        minOrderCents: 100000,
        isActive: true,
      },
    ])
    .onConflictDoNothing({ target: coupons.code });
}

const SAMPLE_BOOKS = [
  {
    slug: "the-quiet-shelf",
    title: "The Quiet Shelf",
    author: "Ana Belén Ruiz",
    genre: "essays",
    priceCents: 1400,
    stockQuantity: 12,
    isFeatured: true,
    description: "Placeholder copy. Sample data for local development.",
  },
  {
    slug: "letters-to-a-cartographer",
    title: "Letters to a Cartographer",
    author: "Hiroshi Tanabe",
    genre: "translated",
    priceCents: 1150,
    // One copy left, so the "last copy" badge and the quantity stepper's clamp
    // are both reachable without editing stock by hand.
    stockQuantity: 1,
    description: "Placeholder copy. Sample data for local development.",
  },
  {
    slug: "salt-and-almanac",
    title: "Salt and Almanac",
    author: "Marguerite Okonkwo",
    genre: "poetry",
    priceCents: 1600,
    stockQuantity: 7,
    description: "Placeholder copy. Sample data for local development.",
  },
  {
    slug: "a-winter-of-small-repairs",
    title: "A Winter of Small Repairs",
    author: "Tomas Lindqvist",
    genre: "fiction",
    priceCents: 1200,
    stockQuantity: 9,
    description: "Placeholder copy. Sample data for local development.",
  },
  {
    slug: "the-long-field",
    title: "The Long Field",
    author: "Ide Ó Cuinneagáin",
    genre: "nature",
    priceCents: 1350,
    // Sold out, so the out-of-stock rejection path has something to reject.
    stockQuantity: 0,
    description: "Placeholder copy. Sample data for local development.",
  },
  {
    slug: "nine-bridges",
    title: "Nine Bridges",
    author: "Petra Sandoval",
    genre: "fiction",
    priceCents: 1500,
    stockQuantity: 4,
    description: "Placeholder copy. Sample data for local development.",
  },
  {
    slug: "an-orchard-in-reverse",
    title: "An Orchard in Reverse",
    author: "Cordelia Nwachukwu",
    genre: "poetry",
    priceCents: 1300,
    stockQuantity: 6,
    description: "Placeholder copy. Sample data for local development.",
  },
  {
    slug: "the-weather-in-other-rooms",
    title: "The Weather in Other Rooms",
    author: "Jonas Ferreira",
    genre: "translated",
    priceCents: 1050,
    stockQuantity: 11,
    description: "Placeholder copy. Sample data for local development.",
  },
  {
    slug: "everything-we-kept",
    title: "Everything We Kept",
    author: "Su-jin Park",
    genre: "fiction",
    priceCents: 1700,
    stockQuantity: 3,
    isFeatured: true,
    description: "Placeholder copy. Sample data for local development.",
  },
];

const SAMPLE_AUTHORS = [...new Set(SAMPLE_BOOKS.map((book) => book.author))];
