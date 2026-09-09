import { Injectable } from "@nestjs/common";
import { and, eq, inArray, sql } from "drizzle-orm";
import { DbService } from "../db/db.service";
import type { Executor, Transaction } from "../db/db.types";
import { books } from "../db/schema";
import { OutOfStockError } from "./inventory.errors";
import { publicAvailableSql, reservedQuantitySql } from "./reservations";

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
   * What it checks is the *unreserved* remainder, not the stock count. Sixty
   * copies against sixty live invites is nothing a stranger may buy, and
   * checking `stockQuantity` alone is what used to let one take a copy that
   * had been promised to somebody who had been waiting for weeks. Since
   * reserved can never be below zero, requiring `stock - reserved >= quantity`
   * also makes `stock >= quantity` true — so this cannot drive the column
   * negative, and does not need a separate guard saying so.
   *
   * An invited customer passes this same check rather than bypassing it.
   * `WaitlistInviteService.consume` spends their token earlier in this
   * transaction, which drops their own reservation out of the subquery and
   * frees exactly the copy it was holding. That is why there is no longer an
   * `allowNegative` here and no "except for this book" argument: the holder is
   * admitted by the arithmetic rather than by an exemption from it.
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
      .where(
        and(
          eq(books.id, bookId),
          sql`${books.stockQuantity} - ${reservedQuantitySql(books.id)} >= ${quantity}`,
        ),
      )
      .returning({ stockQuantity: books.stockQuantity });

    if (updated) return updated.stockQuantity;

    // Reported as what this customer could have had, not as the raw shelf
    // count: telling someone "0 available" while the page behind them says 60
    // in stock is the confusing half of the truth. The copies exist; they are
    // just already owed to other people.
    const [current] = await tx
      .select({ available: publicAvailableSql(books.stockQuantity, books.id) })
      .from(books)
      .where(eq(books.id, bookId));

    // A missing book is still reported as out of stock rather than not-found.
    // By this point the cart has already been priced against a live catalog
    // row, so "the book vanished mid-checkout" is a race, not a bad request,
    // and the client's recovery is identical either way: drop the line.
    throw new OutOfStockError(bookId, quantity, current?.available ?? 0);
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
   *
   * Counts what an ordinary shopper may buy, not what is on the shelf. A badge
   * reading "2 left" over copies that are all promised to waitlist invites
   * would be an invitation to try, and the guarded decrement would then refuse
   * — so this answers the same question that guard does. A holder of one of
   * those invites is the exception, and the cart quote handles them explicitly
   * (see `PricingService.rejectionFor`) rather than through this.
   */
  async availability(
    bookIds: string[],
    executor: Executor = this.dbService.db,
  ): Promise<Map<string, number>> {
    if (bookIds.length === 0) return new Map();

    const rows = await executor
      .select({ id: books.id, available: publicAvailableSql(books.stockQuantity, books.id) })
      .from(books)
      .where(inArray(books.id, bookIds));

    return new Map(rows.map((row) => [row.id, row.available]));
  }
}
