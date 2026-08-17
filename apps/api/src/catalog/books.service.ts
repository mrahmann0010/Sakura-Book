import { Injectable } from "@nestjs/common";
import { DbService } from "../db/db.service";
import type { Executor } from "../db/db.types";
import type { PriceableBook } from "./book.types";

/**
 * Reads over the `books` table.
 *
 * Only the pricing lookup exists today — the browse and detail endpoints are
 * Phase 2. It lives here rather than in PricingService because the direction of
 * the dependency matters: pricing may read the catalog, and the catalog may not
 * know that prices are ever summed. Putting the query in pricing would make
 * `books` a table two modules write queries against, which is the point at
 * which "catalog owns the catalog" stops being true.
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
        },
      ]),
    );
  }
}
