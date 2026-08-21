import { Injectable } from "@nestjs/common";
import type {
  AdminPreOrderBookList,
  AdminPreOrderBookUpsertRequest,
  PreOrderBook,
} from "@sakura/contracts";
import { desc, eq } from "drizzle-orm";
import { ResourceNotFoundError } from "../../common/errors";
import { DbService } from "../../db/db.service";
import { preOrderBooks } from "../../db/schema";
import { toPreOrderBookResponse } from "../../pre-orders/pre-order-book.mapper";

/**
 * Staff CRUD over `pre_order_books`.
 *
 * Separate from PreOrderBooksService (apps/api/src/pre-orders), which is
 * storefront-only and read-only, on the same split as AdminOrdersService vs.
 * OrdersService — the module boundary is "who is allowed to write this".
 */
@Injectable()
export class AdminPreOrderBooksService {
  constructor(private readonly dbService: DbService) {}

  async list(): Promise<AdminPreOrderBookList> {
    const rows = await this.dbService.db
      .select()
      .from(preOrderBooks)
      .orderBy(desc(preOrderBooks.createdAt));

    const items = rows.map(toPreOrderBookResponse);

    return { items, total: items.length, page: 1, totalPages: 1 };
  }

  async create(request: AdminPreOrderBookUpsertRequest): Promise<PreOrderBook> {
    const [row] = await this.dbService.db
      .insert(preOrderBooks)
      .values({
        title: request.title,
        authorName: request.authorName,
        description: request.description,
        pageCount: request.pageCount ?? null,
        priceCents: request.priceCents,
        coverImageUrl: request.coverImageUrl,
        coverImageAlt: request.coverImageAlt ?? null,
        isActive: request.isActive,
      })
      .returning();

    return toPreOrderBookResponse(row);
  }

  async update(id: string, request: AdminPreOrderBookUpsertRequest): Promise<PreOrderBook> {
    const [row] = await this.dbService.db
      .update(preOrderBooks)
      .set({
        title: request.title,
        authorName: request.authorName,
        description: request.description,
        pageCount: request.pageCount ?? null,
        priceCents: request.priceCents,
        coverImageUrl: request.coverImageUrl,
        coverImageAlt: request.coverImageAlt ?? null,
        isActive: request.isActive,
      })
      .where(eq(preOrderBooks.id, id))
      .returning();

    if (!row) throw new ResourceNotFoundError("Pre-order book", id);

    return toPreOrderBookResponse(row);
  }
}
