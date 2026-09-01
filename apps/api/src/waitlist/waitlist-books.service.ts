import { Injectable } from "@nestjs/common";
import type { AdminWaitlistBook, WaitlistBook } from "@sakura/contracts";
import { and, asc, eq, inArray } from "drizzle-orm";
import { ResourceNotFoundError } from "../common/errors";
import { DbService } from "../db/db.service";
import type { Executor, Transaction } from "../db/db.types";
import { books } from "../db/schema";

/**
 * Which titles /notify offers to wait on.
 *
 * Same shape as RestockScheduleService, and here for the same reason: the
 * storefront read and the admin write are two views of one decision, so they
 * go through one service rather than growing separate ideas of what the list
 * is. This one lives on `books.waitlistEnabled` rather than in `shop_settings`
 * because the fact is per title — see the column's comment.
 *
 * The /notify page used to name a single book by slug in its own source. That
 * constant is what this replaces.
 */
@Injectable()
export class WaitlistBooksService {
  constructor(private readonly dbService: DbService) {}

  /**
   * The titles a customer may pick, alphabetical.
   *
   * Inactive books are excluded: a title withdrawn from the catalog should not
   * keep appearing in a picker, and staff forgetting to untick it is exactly
   * the kind of thing this filter exists to survive. Stock is deliberately
   * *not* filtered on — see `adminWaitlistBookSchema`, offering an in-stock
   * title is a choice staff are allowed to make.
   */
  async offered(executor: Executor = this.dbService.db): Promise<WaitlistBook[]> {
    return executor
      .select({ id: books.id, title: books.title })
      .from(books)
      .where(and(eq(books.waitlistEnabled, true), eq(books.isActive, true)))
      .orderBy(asc(books.title));
  }

  /** Every book with its current flag — the selection screen's list. */
  async describeAll(executor: Executor = this.dbService.db): Promise<AdminWaitlistBook[]> {
    return executor
      .select({
        id: books.id,
        slug: books.slug,
        title: books.title,
        stockQuantity: books.stockQuantity,
        availability: books.availability,
        isActive: books.isActive,
        waitlistEnabled: books.waitlistEnabled,
      })
      .from(books)
      .orderBy(asc(books.title));
  }

  /**
   * Set the selection to exactly these ids.
   *
   * Two statements, both inside the caller's transaction: clear everything,
   * then set the chosen rows. A diff would touch fewer rows and would have to
   * be right about which — over a catalog of dozens of titles, on a setting
   * saved a few times a year, "the list is now exactly this" is worth more
   * than the writes it saves. Doing it outside a transaction would leave a
   * window where /notify offers nothing.
   */
  async setSelection(bookIds: string[], tx: Transaction): Promise<void> {
    await tx.update(books).set({ waitlistEnabled: false }).where(eq(books.waitlistEnabled, true));

    if (bookIds.length === 0) return;

    const updated = await tx
      .update(books)
      .set({ waitlistEnabled: true })
      .where(inArray(books.id, bookIds))
      .returning({ id: books.id });

    /* An id that matches no book is a 404, not a quietly smaller list. The
       panel sends ids it was just given, so this fires when a title was
       deleted while the screen was open — and staff saving "these two" must
       not be told it worked and then find one of them missing. */
    if (updated.length !== new Set(bookIds).size) {
      throw new ResourceNotFoundError("Book");
    }
  }
}
