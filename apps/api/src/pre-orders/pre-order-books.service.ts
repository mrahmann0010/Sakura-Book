import { Injectable } from "@nestjs/common";
import type { PreOrderBook } from "@sakura/contracts";
import { and, eq } from "drizzle-orm";
import { DbService } from "../db/db.service";
import type { Executor } from "../db/db.types";
import { preOrderBooks } from "../db/schema";
import { ResourceNotFoundError } from "../common/errors";
import { toPreOrderBookResponse, type PreOrderBookRow } from "./pre-order-book.mapper";

/**
 * Reads over `pre_order_books`. Writes live in AdminPreOrderBooksService
 * (apps/api/src/admin/pre-order) — the storefront never creates or edits the
 * title it is pre-selling.
 */
@Injectable()
export class PreOrderBooksService {
  constructor(private readonly dbService: DbService) {}

  /**
   * The one book the catalog page and the pre-order cart page show.
   *
   * Null rather than throwing: "no pre-order running right now" is an
   * expected, ordinary state (this is the storefront read, GET /pre-order-books/active),
   * not an error — the controller turns it into 404 for a client that wants
   * one, and the catalog page simply omits the card.
   */
  async findActive(executor: Executor = this.dbService.db): Promise<PreOrderBook | null> {
    const [row] = await executor
      .select()
      .from(preOrderBooks)
      .where(eq(preOrderBooks.isActive, true))
      .limit(1);

    return row ? toPreOrderBookResponse(row) : null;
  }

  /** Row (not the wire shape), for the checkout service to snapshot from. */
  async findRowById(id: string, executor: Executor = this.dbService.db): Promise<PreOrderBookRow> {
    const [row] = await executor
      .select()
      .from(preOrderBooks)
      .where(and(eq(preOrderBooks.id, id), eq(preOrderBooks.isActive, true)))
      .limit(1);

    if (!row) throw new ResourceNotFoundError("Pre-order book", id);

    return row;
  }
}
