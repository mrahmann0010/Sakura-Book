import { Injectable, Logger } from "@nestjs/common";
import type { UnitsSoldDrift, UnitsSoldReport } from "@sakura/contracts";
import { sql } from "drizzle-orm";
import { DbService } from "../db/db.service";

/**
 * Recomputes `books.units_sold` from the order history.
 *
 * The column's schema comment has asked for this since it was written: the
 * rollup is a cache maintained by an event listener, the listener runs after
 * its transaction commits, and an event can be lost if the process dies in
 * between. Nothing about that is a bug to fix — it is the price of keeping the
 * write out of the checkout transaction, where it would put row contention on
 * the shop's most popular titles to protect a number nobody is charged for.
 * What it needs instead is something that can put the number right.
 *
 * ## What counts as sold
 *
 * The same rule the listener applies, expressed as a join instead of as a
 * sequence of events: an order counts once it has reached PAYMENT_CONFIRMED
 * and has not been cancelled. Because the listener works in deltas and this
 * works in totals, they can only agree if "counted" means the same thing in
 * both — so the statuses below are the listener's COUNTED_STATUSES, and
 * CANCELLED is the one it reverses.
 *
 * REFUNDED is counted here, matching the listener's decision not to reverse
 * it. That decision is worth disagreeing with — an order refunded before
 * dispatch never left the building — but it must be disagreed with in *both*
 * places at once, or reconciliation and the rollup will fight, each undoing
 * the other's answer on every run.
 */
@Injectable()
export class UnitsSoldReconciler {
  private readonly logger = new Logger(UnitsSoldReconciler.name);

  constructor(private readonly dbService: DbService) {}

  /**
   * Compare the cache against the history without touching anything.
   *
   * A dry run is the default because this is a number staff look at rather
   * than one anything depends on: seeing that eleven titles have drifted by a
   * copy each is usually the whole answer, and a panel that could only
   * *inspect* by *writing* would be one nobody dares press.
   */
  async report(): Promise<UnitsSoldReport> {
    const rows = await this.drift();

    return {
      checkedAt: new Date().toISOString(),
      booksChecked: rows.total,
      drifted: rows.drifted,
      corrected: false,
    };
  }

  /**
   * Put the cache right, and report what moved.
   *
   * The drift is measured *inside* the same transaction as the correction, so
   * the report describes the write that actually happened rather than a state
   * that had already moved on. Without that, an order confirming between the
   * read and the write would appear in the report as a discrepancy the run had
   * supposedly fixed — and the next run would report it again, which reads as
   * a reconciler that does not work.
   */
  async reconcile(): Promise<UnitsSoldReport> {
    const { total, drifted } = await this.dbService.db.transaction(async (tx) => {
      const measured = await this.drift(tx);

      if (measured.drifted.length > 0) {
        /**
         * One statement for the whole table. The correlated subquery is
         * evaluated per row by Postgres, which is the same work a loop would
         * do minus a round-trip each — and, more importantly, it cannot be
         * interleaved with a concurrent rollup the way N separate updates can.
         *
         * `coalesce(..., 0)` matters: a book that has never sold has no rows
         * in the join at all, and `sum` over no rows is null, not zero. Without
         * it, reconciliation would set `units_sold` to null on every unsold
         * title — a not-null violation on the lucky runs and a silent wipe on
         * any schema that permitted it.
         */
        await tx.execute(sql`
          update books
          set units_sold = coalesce((
            select sum(oi.quantity)
            from order_items oi
            join orders o on o.id = oi.order_id
            where oi.book_id = books.id
              and o.status = any(${COUNTED_STATUSES})
          ), 0)
          where units_sold is distinct from coalesce((
            select sum(oi.quantity)
            from order_items oi
            join orders o on o.id = oi.order_id
            where oi.book_id = books.id
              and o.status = any(${COUNTED_STATUSES})
          ), 0)
        `);
      }

      return measured;
    });

    if (drifted.length > 0) {
      this.logger.warn(`Reconciled units_sold for ${drifted.length} of ${total} titles`);
    }

    return {
      checkedAt: new Date().toISOString(),
      booksChecked: total,
      drifted,
      corrected: true,
    };
  }

  /**
   * Every title whose cached figure disagrees with the join, plus how many
   * titles were examined.
   *
   * `is distinct from` rather than `<>`, because `null <> 0` is null and a
   * title that has never sold would therefore never be reported as drifted —
   * which is precisely the row most likely to be wrong after a lost event.
   */
  private async drift(
    executor: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> } = this.dbService.db,
  ): Promise<{ total: number; drifted: UnitsSoldDrift[] }> {
    const result = (await executor.execute(sql`
      with actual as (
        select b.id, b.slug, b.title, b.units_sold as recorded,
          coalesce((
            select sum(oi.quantity)
            from order_items oi
            join orders o on o.id = oi.order_id
            where oi.book_id = b.id and o.status = any(${COUNTED_STATUSES})
          ), 0)::int as actual
        from books b
      )
      select slug, title, recorded, actual, (actual - recorded) as delta,
        (select count(*)::int from actual) as total
      from actual
      where recorded is distinct from actual
      order by abs(actual - recorded) desc, slug
    `)) as unknown as { slug: string; title: string; recorded: number; actual: number; delta: number; total: number }[];

    const rows = Array.isArray(result) ? result : [];

    return {
      // The window carries the total on every row; with no drifted rows there
      // is nothing to read it off, and "nothing drifted" needs a count anyway.
      total: rows[0]?.total ?? (await this.bookCount(executor)),
      drifted: rows.map((row) => ({
        slug: row.slug,
        title: row.title,
        recorded: Number(row.recorded),
        actual: Number(row.actual),
        delta: Number(row.delta),
      })),
    };
  }

  private async bookCount(executor: {
    execute: (query: ReturnType<typeof sql>) => Promise<unknown>;
  }): Promise<number> {
    const result = (await executor.execute(
      sql`select count(*)::int as total from books`,
    )) as unknown as { total: number }[];

    return Number((Array.isArray(result) ? result[0]?.total : 0) ?? 0);
  }
}

/**
 * The statuses at or past PAYMENT_CONFIRMED that were not cancelled — i.e.
 * exactly the orders SalesRollupListener has counted and not reversed.
 *
 * Kept in step with COUNTED_STATUSES in sales-rollup.listener.ts by the unit
 * test that asserts the two lists are equal. They are two expressions of one
 * rule and drift between them makes reconciliation and the rollup disagree
 * permanently, each correcting what the other just wrote.
 */
export const COUNTED_STATUSES: readonly string[] = Object.freeze([
  "PAYMENT_CONFIRMED",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "REFUNDED",
]);
