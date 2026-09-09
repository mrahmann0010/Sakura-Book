import { Injectable } from "@nestjs/common";
import type { WaitlistEntry, WaitlistSubscribeRequest } from "@sakura/contracts";
import { and, eq } from "drizzle-orm";
import { DuplicateResourceError, ResourceNotFoundError } from "../common/errors";
import { DbService } from "../db/db.service";
import { books, waitlistEntries } from "../db/schema";
import { toE164Bd } from "../sms/phone";

@Injectable()
export class WaitlistService {
  constructor(private readonly dbService: DbService) {}

  /**
   * Join a book's restock waitlist.
   *
   * `source`/`locale` are recorded as sent; this endpoint doesn't decide what
   * they mean, it just stores them. `bookTitleSnapshot` is the exception, and
   * is deliberately *not* taken from the request: it is read from the catalog
   * here, so the record says what the shop called the book at the moment they
   * asked, rather than what a browser posted.
   *
   * The phone is normalized to E.164 (`toE164Bd`, the same helper the SMS
   * gateway path uses) before it is compared or stored, not just typed as
   * submitted. Without that, "01712345678" and "+8801712345678" are two
   * different strings that both pass the unique index below, and the same
   * person joins the same book's list twice — which is exactly the duplicate
   * this index exists to stop.
   *
   * The duplicate check is a query, not a caught constraint violation: the
   * Postgres driver here wraps every error in `DrizzleQueryError`, which is
   * not a `PostgresError` itself, so `mapPostgresError`'s `instanceof` check
   * never fires and a unique-index hit would otherwise surface as an opaque
   * 500 — see `orders/transaction-id-claim.ts` for the same tradeoff made the
   * same way on the checkout path. The index remains the backstop for the
   * race this query cannot close.
   */
  async subscribe(request: WaitlistSubscribeRequest): Promise<WaitlistEntry> {
    const book = await this.findBook(request.bookId);
    const phone = toE164Bd(request.phone);

    const existing = await this.dbService.db.query.waitlistEntries.findFirst({
      where: and(eq(waitlistEntries.customerPhone, phone), eq(waitlistEntries.bookId, book.id)),
      columns: { id: true },
    });

    if (existing) {
      throw new DuplicateResourceError("Waitlist entry");
    }

    const [row] = await this.dbService.db
      .insert(waitlistEntries)
      .values({
        bookId: book.id,
        bookTitleSnapshot: book.title,
        customerName: request.fullName,
        customerEmail: request.email,
        customerPhone: phone,
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
