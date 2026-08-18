import { Injectable } from "@nestjs/common";
import { and, eq, gte, sql } from "drizzle-orm";
import { DbService } from "../db/db.service";
import type { Executor, Transaction } from "../db/db.types";
import { books } from "../db/schema";
import { OutOfStockError } from "./inventory.errors";

/**
 * Stock movement. The only writer of `books.stock_quantity`.
 *
 * Inventory and catalog share the `books` table, which is the one boundary
 * violation this design accepts deliberately: a shop with dozens of titles
 * does not need a separate stock table, and splitting one would buy a join and
 * a consistency problem in exchange for a tidier diagram. The rule that keeps
 * it honest is directional — catalog reads stock and never writes it,
 * inventory writes stock and never reads catalog columns.
 */
@Injectable()
export class InventoryService {
  constructor(private readonly dbService: DbService) {}

  /**
   * Take `quantity` units off a title, or fail.
   *
   * The availability check lives in the UPDATE's WHERE clause rather than in a
   * SELECT beforehand, for the same reason as CouponsService.redeem: two
   * checkouts racing for the last copy would both read `stockQuantity = 1`,
   * both decide it is fine, and both write. Here Postgres serialises the two
   * updates on the row lock and the loser matches zero rows.
   *
   * Zero rows is ambiguous on its own — the book might not exist at all — so
   * the follow-up read distinguishes the two. It runs only on the failure
   * path, and it is inside the same transaction, so it sees a consistent
   * snapshot rather than a value that moved again in between.
   *
   * Takes a `Transaction` rather than an `Executor` because throwing is how
   * this method reports failure, and the throw is only a *recovery* if it
   * rolls something back: a three-line cart that runs out on line two must not
   * leave lines one and three decremented. On the root db each statement
   * auto-commits and the exception strands the earlier writes, so "call this
   * outside a transaction" is not a use case, and the type says so.
   */
  async decrement(bookId: string, quantity: number, tx: Transaction): Promise<number> {
    const [updated] = await tx
      .update(books)
      .set({ stockQuantity: sql`${books.stockQuantity} - ${quantity}` })
      .where(and(eq(books.id, bookId), gte(books.stockQuantity, quantity)))
      .returning({ stockQuantity: books.stockQuantity });

    if (updated) return updated.stockQuantity;

    const current = await tx.query.books.findFirst({
      where: eq(books.id, bookId),
      columns: { stockQuantity: true },
    });

    // A missing book is still reported as out of stock rather than not-found.
    // By this point the cart has already been priced against a live catalog
    // row, so "the book vanished mid-checkout" is a race, not a bad request,
    // and the client's recovery is identical either way: drop the line.
    throw new OutOfStockError(bookId, quantity, current?.stockQuantity ?? 0);
  }

  /**
   * Put stock back — a cancelled order, or an admin correction.
   *
   * Unguarded on purpose: there is no upper bound to race against, so this can
   * never fail the way decrement can. It is still a guarded *statement* in the
   * sense that matters, because the arithmetic happens in the database rather
   * than in JS, so a concurrent decrement cannot be lost.
   *
   * Still a `Transaction`, despite being unable to fail on its own. Returning
   * stock is always paired with the status change that justifies it, and the
   * pair has to be atomic in the other direction: stock handed back for an
   * order that then fails to reach CANCELLED is inventory invented from
   * nothing. See STOCK_HELD_STATUSES in orders/order-status.machine.ts.
   */
  async increment(bookId: string, quantity: number, tx: Transaction): Promise<void> {
    await tx
      .update(books)
      .set({ stockQuantity: sql`${books.stockQuantity} + ${quantity}` })
      .where(eq(books.id, bookId));
  }

  /**
   * Advisory pre-check for the cart page — "2 left" badges and the quantity
   * stepper's maximum. Never a substitute for decrement's guard: whatever this
   * returns can be stale by the time the customer clicks Place Order.
   */
  async availability(
    bookIds: string[],
    executor: Executor = this.dbService.db,
  ): Promise<Map<string, number>> {
    if (bookIds.length === 0) return new Map();

    const rows = await executor.query.books.findMany({
      where: (book, { inArray }) => inArray(book.id, bookIds),
      columns: { id: true, stockQuantity: true },
    });

    return new Map(rows.map((row) => [row.id, row.stockQuantity]));
  }
}
