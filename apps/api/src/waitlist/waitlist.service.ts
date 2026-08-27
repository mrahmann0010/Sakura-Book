import { Injectable } from "@nestjs/common";
import type { WaitlistEntry, WaitlistSubscribeRequest } from "@sakura/contracts";
import { and, eq, isNull } from "drizzle-orm";
import { DuplicateResourceError, ResourceNotFoundError } from "../common/errors";
import { DbService } from "../db/db.service";
import { books, waitlistEntries } from "../db/schema";

@Injectable()
export class WaitlistService {
  constructor(private readonly dbService: DbService) {}

  /**
   * Join a restock waitlist — the shop-wide one, or one title's.
   *
   * `bookId` decides which. Absent means the general list, which is what the
   * shop-wide pause needs and what every entry written before this existed
   * is. Present means a wait on that title, and the two live in one table
   * under two partial unique indexes: a phone may wait on several different
   * books, but not join the same book's list — or the general list — twice.
   *
   * `source`/`locale` are recorded as sent; this endpoint doesn't decide what
   * they mean, it just stores them. `bookTitleSnapshot` is the exception, and
   * is deliberately *not* taken from the request: it is read from the catalog
   * here, so the record says what the shop called the book at the moment they
   * asked, rather than what a browser posted.
   *
   * The duplicate check is a query, not a caught constraint violation: the
   * Postgres driver here wraps every error in `DrizzleQueryError`, which is
   * not a `PostgresError` itself, so `mapPostgresError`'s `instanceof` check
   * never fires and a unique-index hit would otherwise surface as an opaque
   * 500 — see `orders/transaction-id-claim.ts` for the same tradeoff made the
   * same way on the checkout path. The indexes remain the backstop for the
   * race this query cannot close.
   */
  async subscribe(request: WaitlistSubscribeRequest): Promise<WaitlistEntry> {
    const book = request.bookId ? await this.findBook(request.bookId) : null;

    const existing = await this.dbService.db.query.waitlistEntries.findFirst({
      where: and(
        eq(waitlistEntries.customerPhone, request.phone),
        /* Matches the index that would reject the insert: the general list is
           keyed on a null book, a per-book list on that book's id. Comparing
           with `eq` against null would match nothing and let a duplicate
           through to a 500 — `is null` is the only form that works here. */
        book ? eq(waitlistEntries.bookId, book.id) : isNull(waitlistEntries.bookId),
      ),
      columns: { id: true },
    });

    if (existing) {
      throw new DuplicateResourceError("Waitlist entry");
    }

    const [row] = await this.dbService.db
      .insert(waitlistEntries)
      .values({
        bookId: book?.id ?? null,
        bookTitleSnapshot: book?.title ?? null,
        customerName: request.fullName,
        customerEmail: request.email,
        customerPhone: request.phone,
        quantity: request.quantity,
        locale: request.locale,
        source: request.source,
      })
      .returning({
        id: waitlistEntries.id,
        status: waitlistEntries.status,
        bookTitle: waitlistEntries.bookTitleSnapshot,
        createdAt: waitlistEntries.createdAt,
      });

    return {
      id: row.id,
      status: row.status,
      bookTitle: row.bookTitle,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * The book they picked, if it is one a customer could have picked.
   *
   * `isActive` is checked because the picker is built from the public catalog,
   * which excludes delisted titles — so an id for one can only have come from
   * a stale page or a hand-made request, and silently accepting it would file
   * someone in a queue for a book the shop has withdrawn.
   *
   * Availability is deliberately *not* checked. The picker shows what is out
   * of stock, but a title selling out or coming back between the page render
   * and the submit is normal, and a 400 in that window would reject a signup
   * for the most ordinary reason imaginable.
   */
  private async findBook(bookId: string): Promise<{ id: string; title: string }> {
    const book = await this.dbService.db.query.books.findFirst({
      where: and(eq(books.id, bookId), eq(books.isActive, true)),
      columns: { id: true, title: true },
    });

    if (!book) throw new ResourceNotFoundError("Book");

    return book;
  }
}
