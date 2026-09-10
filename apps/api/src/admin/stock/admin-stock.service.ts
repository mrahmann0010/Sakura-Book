import { Injectable } from "@nestjs/common";
import type { AdminStockList, AdminStockRow } from "@sakura/contracts";
import { and, asc, eq, sql } from "drizzle-orm";
import { DbService } from "../../db/db.service";
import { books, waitlistAllocations } from "../../db/schema";
import { publicAvailableSql, reservedQuantitySql, ringfencedQuantitySql } from "../../inventory";

/**
 * Supply and demand for every title, in one read.
 *
 * The screen this backs exists because the three numbers that decide whether
 * an invite can send lived in three places and the fourth — what the public
 * may actually buy — lived in none of them. A staff member could set stock in
 * the catalog form, set the queue's share on the waitlist page, and still have
 * no way to answer "so how many are on the shelf?" without loading the
 * storefront.
 *
 * Nothing here computes anything new. Every column is one of the expressions
 * the storefront, the cart quote and the guarded decrement already render
 * from, which is the point: a row that disagreed with the shop it describes
 * would be worse than no screen at all.
 *
 * Deliberately its own module rather than a route on the books controller.
 * What is being asked about is not a property of a title — it is a decision
 * about one restock, and it draws on the waitlist as much as on the catalog.
 */
@Injectable()
export class AdminStockService {
  constructor(private readonly dbService: DbService) {}

  /**
   * Every active title, warnings first.
   *
   * Sorted so the rows that need a person come to the top and stay there: an
   * over-issued book, then a queue with nobody funding it, then everything
   * else by title. A manager opening this in the morning should be able to
   * stop reading as soon as the warnings run out.
   *
   * Inactive titles are excluded. They cannot be bought or waited on, so a
   * stock number against one is not a decision anybody is going to make.
   */
  async list(): Promise<AdminStockList> {
    /* Counted from the entries themselves rather than joined and grouped: a
       book with two hundred people waiting and a book with none must both
       produce exactly one row, and a left join to a filtered aggregate is the
       shape that quietly drops the second. Lanes rather than status, for the
       reason `waitlist-lane.ts` gives — CONVERTED and CANCELLED are the two
       terminal states, and everyone else is still waiting on this book in the
       sense a restock cares about. */
    const waitingSql = sql<number>`coalesce((
      select count(*)
      from waitlist_entries we
      where we.book_id = ${books.id}
        and we.status not in ('CONVERTED', 'CANCELLED')
    ), 0)::int`;

    const waitingQuantitySql = sql<number>`coalesce((
      select sum(we.quantity)
      from waitlist_entries we
      where we.book_id = ${books.id}
        and we.status not in ('CONVERTED', 'CANCELLED')
    ), 0)::int`;

    const rows = await this.dbService.db
      .select({
        bookId: books.id,
        title: books.title,
        slug: books.slug,
        onHand: books.stockQuantity,
        promised: reservedQuantitySql(books.id),
        reserved: ringfencedQuantitySql(books.id),
        onShelf: publicAvailableSql(books.stockQuantity, books.id),
        waiting: waitingSql,
        waitingQuantity: waitingQuantitySql,
        allocationId: waitlistAllocations.id,
        allocationCopies: waitlistAllocations.copies,
      })
      .from(books)
      /* Left, and narrowed to OPEN in the join condition rather than in
         `where`: a book with no open release still has a row to show, and
         filtering in `where` would turn this into an inner join by the back
         door and hide exactly the books the screen is meant to flag. The
         partial unique index guarantees at most one match, so this cannot
         duplicate a title. */
      .leftJoin(
        waitlistAllocations,
        and(eq(waitlistAllocations.bookId, books.id), eq(waitlistAllocations.status, "OPEN")),
      )
      .where(eq(books.isActive, true))
      .orderBy(asc(books.title));

    const items: AdminStockRow[] = rows.map((row) => ({
      bookId: row.bookId,
      title: row.title,
      slug: row.slug,
      onHand: row.onHand,
      promised: row.promised,
      reserved: row.reserved,
      onShelf: row.onShelf,
      waiting: row.waiting,
      waitingQuantity: row.waitingQuantity,
      allocationId: row.allocationId,
      allocationCopies: row.allocationCopies,
      /* The same reading `WaitlistAllocationService.describe` gives it: more
         copies held than the shop owns. Computed from the two columns rather
         than carried over from the release, because a book can be over-issued
         while holding no release at all — invites charged to one that has
         since been closed still hold their copies. */
      overIssued: row.onHand - row.promised < 0,
    }));

    return { items: items.sort(byUrgency) };
  }
}

/**
 * Warnings first, then alphabetical.
 *
 * The sort is the screen's whole editorial position: a book that will refuse
 * every invite it is asked to send should not be findable only by scrolling.
 * Over-issue outranks an unfunded queue because it is already costing the shop
 * sales — the storefront refuses to sell an over-issued title to anybody.
 */
function byUrgency(a: AdminStockRow, b: AdminStockRow): number {
  const rank = (row: AdminStockRow) =>
    row.overIssued ? 0 : row.waiting > 0 && row.allocationId === null ? 1 : 2;

  return rank(a) - rank(b) || a.title.localeCompare(b.title);
}
