import { Injectable } from "@nestjs/common";
import type { BookDetail, BookList, BookQuery, BookSummary } from "@sakura/contracts";
import { inArray, sql } from "drizzle-orm";
import { DbService } from "../db/db.service";
import type { Executor } from "../db/db.types";
import { books, bookReviews } from "../db/schema";
import { BookNotFoundError } from "./book.errors";
import { toBookDetail, toBookSummary } from "./book.mapper";
import { bookFilters, bookOrder, orderByIds } from "./book.query";
import type { PriceableBook, RatingAggregate } from "./book.types";

/**
 * Reads over the `books` table.
 *
 * Browse, detail, and the pricing lookup that pricing and checkout depend on.
 * The pricing read lives here rather than in PricingService because the
 * direction of the dependency matters: pricing may read the catalog, and the
 * catalog may not know that prices are ever summed. Putting the query in
 * pricing would make `books` a table two modules write queries against, which
 * is the point at which "catalog owns the catalog" stops being true.
 *
 * Note what this service does *not* do: it never writes `stock_quantity`. That
 * column is InventoryService's, and the split is directional by decision — see
 * the comment at the top of inventory/inventory.service.ts.
 */
@Injectable()
export class BooksService {
  constructor(private readonly dbService: DbService) {}

  /**
   * Fetch the pricing snapshot for a set of ids, keyed by id.
   *
   * A Map rather than an array because every caller immediately needs to ask
   * "was this particular id found?" — the ones that were not are a reportable
   * outcome (a delisted book still sitting in someone's localStorage cart),
   * not an error, so the absence has to be cheap to detect per id.
   *
   * Inactive books are returned rather than filtered out. The caller has to
   * distinguish "no such book" from "no longer for sale" to report the right
   * rejection reason, and a WHERE clause here would collapse the two.
   *
   * Takes an `Executor` so checkout can re-read prices inside its own
   * transaction: a quote taken outside one is advisory, and the order must be
   * priced against rows that are still there when it commits.
   */
  async priceable(
    bookIds: string[],
    executor: Executor = this.dbService.db,
  ): Promise<Map<string, PriceableBook>> {
    if (bookIds.length === 0) return new Map();

    const rows = await executor.query.books.findMany({
      where: (book, { inArray }) => inArray(book.id, bookIds),
      columns: {
        id: true,
        slug: true,
        title: true,
        coverImageUrl: true,
        priceCents: true,
        stockQuantity: true,
        isActive: true,
        availability: true,
        publishedDate: true,
      },
      with: {
        authors: {
          columns: { sortOrder: true },
          with: { author: { columns: { name: true } } },
        },
      },
    });

    return new Map(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          slug: row.slug,
          title: row.title,
          // Sorted here rather than in SQL: `orderBy` on a nested relational
          // query is per-relation and easy to lose in a later edit, and the
          // list is at most a handful of names per book.
          authors: [...row.authors]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((link) => link.author.name),
          coverImageUrl: row.coverImageUrl,
          priceCents: row.priceCents,
          stockQuantity: row.stockQuantity,
          isActive: row.isActive,
          availability: row.availability,
          publishedDate: row.publishedDate,
        },
      ]),
    );
  }

  /**
   * One page of the shelf.
   *
   * Two queries, deliberately. The first resolves ids in the right order with
   * the filters and the limit applied; the second fetches the full rows for
   * those ids through Drizzle's relational API. One query cannot do both: the
   * filters need EXISTS subqueries and the rows need one-to-many joins for
   * authors, and combining them makes LIMIT count join rows rather than books
   * — which is the classic pagination bug where page 1 shows four titles
   * because one of them has three authors.
   *
   * The count runs alongside as a third statement rather than a window
   * function, because `count(*) over ()` returns nothing at all when the page
   * is empty, and "0 results" is a view the UI has to render.
   */
  async list(query: BookQuery, executor: Executor = this.dbService.db): Promise<BookList> {
    const where = bookFilters(query);
    const offset = (query.page - 1) * query.pageSize;

    const [matched, [{ total }]] = await Promise.all([
      executor
        .select({ id: books.id })
        .from(books)
        .where(where)
        .orderBy(...bookOrder(query.sort))
        .limit(query.pageSize)
        .offset(offset),
      executor
        .select({ total: sql<number>`count(*)::int` })
        .from(books)
        .where(where),
    ]);

    const ids = matched.map((row) => row.id);

    return {
      items: await this.summariesByIds(ids, executor),
      total,
      page: query.page,
      // Ceiling, and 0 when nothing matched — not 1. An empty result has no
      // pages, and reporting 1 makes the pagination control draw a lone
      // disabled button under a "no books found" message.
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  /**
   * Full detail for one book, by slug.
   *
   * Slug rather than id because that is what the URL carries and what the
   * frontend routes on; the UUID primary key never appears in a customer-facing
   * path. Inactive books are excluded here, unlike in `priceable()` — the
   * difference is that a cart needs to *report* on a delisted line it is
   * already holding, whereas a detail page for one is a 404.
   */
  async detail(slug: string, executor: Executor = this.dbService.db): Promise<BookDetail> {
    const row = await executor.query.books.findFirst({
      where: (book, { and, eq: equals }) =>
        and(equals(book.slug, slug), equals(book.isActive, true)),
      with: {
        authors: { columns: { sortOrder: true }, with: { author: { columns: { name: true } } } },
        categories: {
          columns: {},
          with: { category: { columns: { slug: true, name: true, group: true } } },
        },
        publisher: { columns: { slug: true, name: true } },
      },
    });

    if (!row) throw new BookNotFoundError(slug);

    const ratings = await this.ratings([row.id], executor);

    return toBookDetail(row, ratings.get(row.id));
  }

  /**
   * Summaries for a set of ids, in the order given.
   *
   * Shared by `list()` and the author page, which need identical cards from
   * different queries. The relational fetch does not preserve the caller's
   * ordering — `where id in (...)` has no defined order — so `orderByIds`
   * reimposes it rather than the callers each re-sorting.
   */
  async summariesByIds(
    ids: string[],
    executor: Executor = this.dbService.db,
  ): Promise<BookSummary[]> {
    if (ids.length === 0) return [];

    const [rows, ratings] = await Promise.all([
      executor.query.books.findMany({
        where: (book, { inArray: within }) => within(book.id, ids),
        columns: {
          id: true,
          slug: true,
          title: true,
          priceCents: true,
          compareAtPriceCents: true,
          coverImageUrl: true,
          coverImageAlt: true,
          isFeatured: true,
          stockQuantity: true,
          availability: true,
        },
        with: {
          authors: { columns: { sortOrder: true }, with: { author: { columns: { name: true } } } },
        },
      }),
      this.ratings(ids, executor),
    ]);

    return orderByIds(rows, ids).map((row) => toBookSummary(row, ratings.get(row.id)));
  }

  /**
   * Published-review rollup for a set of books, keyed by id.
   *
   * One grouped query for the whole page rather than a correlated subquery per
   * row, because the page already knows every id it needs. Books with no
   * published reviews are simply absent from the map, and the mapper reads
   * that absence as "no rating" — which is every book today, since no review
   * data exists and none may be invented.
   *
   * `avg` comes back from Postgres as a numeric string; `Number` here rather
   * than in the mapper so the boundary where SQL types become JS types stays
   * in the service that ran the SQL.
   */
  private async ratings(
    ids: string[],
    executor: Executor = this.dbService.db,
  ): Promise<Map<string, RatingAggregate>> {
    if (ids.length === 0) return new Map();

    const rows = await executor
      .select({
        bookId: bookReviews.bookId,
        average: sql<string>`round(avg(${bookReviews.rating})::numeric, 2)`,
        count: sql<number>`count(*)::int`,
      })
      .from(bookReviews)
      .where(sql`${bookReviews.isPublished} and ${inArray(bookReviews.bookId, ids)}`)
      .groupBy(bookReviews.bookId);

    return new Map(
      rows.map((row) => [row.bookId, { average: Number(row.average), count: row.count }]),
    );
  }
}
