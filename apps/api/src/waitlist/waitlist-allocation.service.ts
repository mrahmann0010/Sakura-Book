import { Injectable } from "@nestjs/common";
import { and, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { DbService } from "../db/db.service";
import type { Executor, Transaction } from "../db/db.types";
import { books, waitlistAllocations, waitlistEntries } from "../db/schema";
import { reservedQuantitySql } from "../inventory";
import { InvalidInputError, ResourceNotFoundError } from "../common/errors";

/**
 * Stock releases: how much of a print run the waitlist is allowed to spend.
 *
 * This is step 2 of `docs/waitlist-queue-system.md` — the decision a shop
 * makes before anybody is contacted. Sixty copies landed; fifty are the
 * queue's and ten stay for whoever walks in. Without it the invite budget is
 * the whole run, and a long enough queue holds every copy for the length of
 * an invite window.
 *
 * Deliberately separate from `WaitlistInviteService`, which mints and spends
 * tokens and decides nothing, and from `AdminWaitlistInviteService`, which
 * picks people. This class only answers "how many more copies may be promised
 * against this book", and it answers it by counting the invites rather than by
 * reading a column anyone has to maintain.
 */
@Injectable()
export class WaitlistAllocationService {
  constructor(private readonly dbService: DbService) {}

  /**
   * Copies this release has spent: sold through, plus still being held.
   *
   * The two halves of the hold invariant that do *not* return stock. A hold
   * ends as a sale (`invite_used_at` set), as an expiry, or as a withdrawal,
   * and only the first keeps the copies — so the sum below is deliberately not
   * "every invite ever charged here".
   *
   * Expired-and-unspent invites are absent by construction, which is the whole
   * design: **recycling is not an operation.** When a wave's window closes,
   * `remaining` goes up on its own, with no sweep to schedule and nothing that
   * can fail to run. Withdrawn invites vanish for a different reason —
   * `revoke()` nulls `invite_allocation_id` along with the token, so they stop
   * being charged here at the moment they stop holding anything.
   *
   * Sums `quantity`, not rows: three people holding two copies each is six
   * copies spent, not three.
   */
  private committedSql(allocationId: PgColumn | SQL | string): SQL<number> {
    return sql<number>`coalesce((
      select sum(${waitlistEntries.quantity})
      from ${waitlistEntries}
      where ${waitlistEntries.inviteAllocationId} = ${allocationId}
        and (
          ${waitlistEntries.inviteUsedAt} is not null
          or ${waitlistEntries.inviteExpiresAt} > now()
        )
    ), 0)::int`;
  }

  /**
   * The open release for a book, with its budget worked out — or null if the
   * shop has not opened one.
   *
   * `spendable` is the number staff actually get to hand out, and it is the
   * *smaller* of two limits rather than either one alone:
   *
   *   remaining   this release's own budget, less what it has spent
   *   physical    copies that exist and nobody is already holding
   *
   * Allocation narrows; it never widens. Setting `copies` to 80 on a 60-copy
   * book does not conjure twenty books, and the physical term is what says so.
   * Both are floored at zero — an over-issued book (an admin lowering stock
   * under live holds) reads as "nothing to give out" rather than as a negative
   * that some later `>=` accepts by accident.
   */
  async describe(bookId: string, executor: Executor = this.dbService.db): Promise<AllocationBudget | null> {
    const [row] = await executor
      .select({
        id: waitlistAllocations.id,
        copies: waitlistAllocations.copies,
        stockSnapshot: waitlistAllocations.stockSnapshot,
        note: waitlistAllocations.note,
        openedAt: waitlistAllocations.createdAt,
        openedByEmail: waitlistAllocations.openedByEmail,
        committed: this.committedSql(waitlistAllocations.id),
        stockQuantity: books.stockQuantity,
        physicalSpare: sql<number>`${books.stockQuantity} - ${reservedQuantitySql(books.id)}`,
      })
      .from(waitlistAllocations)
      .innerJoin(books, eq(waitlistAllocations.bookId, books.id))
      .where(and(eq(waitlistAllocations.bookId, bookId), eq(waitlistAllocations.status, "OPEN")));

    if (!row) return null;

    const remaining = Math.max(row.copies - row.committed, 0);

    return {
      id: row.id,
      bookId,
      copies: row.copies,
      stockSnapshot: row.stockSnapshot,
      stockQuantity: row.stockQuantity,
      note: row.note,
      committed: row.committed,
      remaining,
      spendable: Math.max(Math.min(remaining, row.physicalSpare), 0),
      /* An honest reading of a book whose stock was lowered under its own
         holds: the shop has promised more copies than it owns. Nothing here
         can fix it — the storefront already refuses to sell, and only a human
         can decide whether to print more or withdraw someone's invite — so the
         one useful thing is to say so where staff will see it. */
      overIssued: row.physicalSpare < 0,
      openedAt: row.openedAt,
      openedByEmail: row.openedByEmail,
    };
  }

  /**
   * Open a release, or fail because one is already open.
   *
   * The partial unique index is what actually enforces one-open-per-book; this
   * check exists to turn the resulting 23505 into a sentence staff can act on.
   * Both are needed — two admins clicking at once reach the index, not this.
   *
   * `stockSnapshot` is read in the same statement that writes the row, so "50
   * of 60" is fixed at the moment of the decision rather than recomputed later
   * against a stock count that has since moved.
   */
  async open(
    input: { bookId: string; copies: number; note?: string | null },
    actor: { id: string; email: string },
    tx: Transaction,
  ): Promise<string> {
    const book = await tx.query.books.findFirst({
      where: eq(books.id, input.bookId),
      columns: { id: true, stockQuantity: true },
    });

    if (!book) throw new ResourceNotFoundError("Book", input.bookId);

    const existing = await tx.query.waitlistAllocations.findFirst({
      where: and(
        eq(waitlistAllocations.bookId, input.bookId),
        eq(waitlistAllocations.status, "OPEN"),
      ),
      columns: { id: true },
    });

    if (existing) {
      throw new InvalidInputError(
        "This book already has an open release. Close it before opening another.",
        { allocationId: existing.id },
      );
    }

    const [row] = await tx
      .insert(waitlistAllocations)
      .values({
        bookId: input.bookId,
        copies: input.copies,
        stockSnapshot: book.stockQuantity,
        note: input.note?.trim() || null,
        openedById: actor.id,
        openedByEmail: actor.email,
      })
      .returning({ id: waitlistAllocations.id });

    return row!.id;
  }

  /**
   * Stop charging new invites to this release.
   *
   * Deliberately does not touch the invites already issued against it. A
   * customer holding a link that works should never have it die because staff
   * tidied up the panel, and the copies they are holding are already accounted
   * for — `committed` reads the invites, not the release's status, so a closed
   * release with live holds still reports them correctly right up until they
   * lapse or convert.
   *
   * Withdrawing holds is a separate, explicit action, because it is a
   * different decision with a different apology attached.
   */
  async close(id: string, actor: { id: string; email: string }, tx: Transaction): Promise<void> {
    const closedAt = new Date();

    const [row] = await tx
      .update(waitlistAllocations)
      .set({
        status: "CLOSED",
        closedAt,
        closedById: actor.id,
        closedByEmail: actor.email,
        updatedAt: closedAt,
      })
      /* Guarded on OPEN rather than on the id alone: closing a closed release
         would otherwise silently restamp who closed it and when, overwriting
         the only record of the decision with a duplicate of itself. */
      .where(and(eq(waitlistAllocations.id, id), eq(waitlistAllocations.status, "OPEN")))
      .returning({ id: waitlistAllocations.id });

    if (!row) throw new ResourceNotFoundError("Open stock release", id);
  }

  /**
   * How many copies each of these books' open releases can still hand out.
   *
   * The batch form of `describe().spendable`, for the invite path, which needs
   * the answer for every book in a selection without a query per book. A book
   * with no open release is **absent from the map**, and callers must treat
   * that as "may not invite" rather than as zero-or-unlimited: falling back to
   * physical stock is how the old "the queue gets the whole print run"
   * behaviour returns through a side door.
   */
  async spendableByBook(
    bookIds: string[],
    options: { excludeEntryIds?: string[] } = {},
    executor: Executor = this.dbService.db,
  ): Promise<Map<string, { allocationId: string; spendable: number }>> {
    if (bookIds.length === 0) return new Map();

    /* Excluded from *both* terms, and that pairing is the point. The invite
       path excludes the entries it is about to re-issue so their existing
       reservation is not charged twice — once as an old hold and again as the
       new one it is about to become. Applying that to physical spare but not
       to this release's committed total would exclude them from one budget and
       not the other, and a re-invite would be refused by whichever still
       counted them. */
    const committed = sql<number>`coalesce((
      select sum(we.quantity)
      from waitlist_entries we
      where we.invite_allocation_id = ${waitlistAllocations.id}
        and (we.invite_used_at is not null or we.invite_expires_at > now())
        ${excludeSql(options.excludeEntryIds)}
    ), 0)::int`;

    const rows = await executor
      .select({
        bookId: waitlistAllocations.bookId,
        allocationId: waitlistAllocations.id,
        copies: waitlistAllocations.copies,
        committed,
        physicalSpare: sql<number>`${books.stockQuantity} - ${reservedQuantitySql(books.id, {
          excludeEntryIds: options.excludeEntryIds,
        })}`,
      })
      .from(waitlistAllocations)
      .innerJoin(books, eq(waitlistAllocations.bookId, books.id))
      .where(
        and(
          eq(waitlistAllocations.status, "OPEN"),
          sql`${waitlistAllocations.bookId} in (${sql.join(
            bookIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`,
        ),
      );

    return new Map(
      rows.map((row) => [
        row.bookId,
        {
          allocationId: row.allocationId,
          spendable: Math.max(Math.min(row.copies - row.committed, row.physicalSpare), 0),
        },
      ]),
    );
  }

  /**
   * Every release a book has had, newest first — the release history panel.
   *
   * `committed` is recomputed for closed releases too rather than frozen at
   * close time. A release that closed while three of its holds were still live
   * keeps settling afterwards: two convert, one lapses, and the honest final
   * answer is the one you get by asking the invites, not the one that happened
   * to be true the afternoon somebody pressed Close.
   */
  async history(bookId: string, executor: Executor = this.dbService.db) {
    return executor
      .select({
        id: waitlistAllocations.id,
        copies: waitlistAllocations.copies,
        stockSnapshot: waitlistAllocations.stockSnapshot,
        note: waitlistAllocations.note,
        status: waitlistAllocations.status,
        committed: this.committedSql(waitlistAllocations.id),
        sold: sql<number>`coalesce((
          select sum(${waitlistEntries.quantity})
          from ${waitlistEntries}
          where ${waitlistEntries.inviteAllocationId} = ${waitlistAllocations.id}
            and ${waitlistEntries.inviteUsedAt} is not null
        ), 0)::int`,
        openedAt: waitlistAllocations.createdAt,
        openedByEmail: waitlistAllocations.openedByEmail,
        closedAt: waitlistAllocations.closedAt,
        closedByEmail: waitlistAllocations.closedByEmail,
      })
      .from(waitlistAllocations)
      .where(eq(waitlistAllocations.bookId, bookId))
      .orderBy(sql`${waitlistAllocations.createdAt} desc`);
  }

  /**
   * Of these entries, the ones currently charging a release — i.e. holding a
   * live, unspent invite.
   *
   * The same three conditions `reservations.ts` holds a copy under, matched
   * here for the reason `AdminWaitlistInviteService.liveInviteHolders` gives:
   * a refused entry keeps its existing invite, so its copies must be charged
   * back to the budget the exclusion above already lent out.
   */
  async liveHolders(ids: string[], executor: Executor = this.dbService.db): Promise<Set<string>> {
    if (ids.length === 0) return new Set();

    const rows = await executor
      .select({ id: waitlistEntries.id })
      .from(waitlistEntries)
      .where(
        and(
          sql`${waitlistEntries.id} in (${sql.join(
            ids.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`,
          isNotNull(waitlistEntries.inviteToken),
          isNull(waitlistEntries.inviteUsedAt),
          sql`${waitlistEntries.inviteExpiresAt} > now()`,
        ),
      );

    return new Set(rows.map((row) => row.id));
  }
}

/** See `WaitlistAllocationService.describe`. */
export type AllocationBudget = {
  id: string;
  bookId: string;
  copies: number;
  stockSnapshot: number;
  stockQuantity: number;
  note: string | null;
  committed: number;
  remaining: number;
  spendable: number;
  overIssued: boolean;
  openedAt: Date;
  openedByEmail: string | null;
};

/**
 * `and we.id not in (...)`, or nothing.
 *
 * Raw `we.` identifiers and one bound parameter per id, both for the reasons
 * `reservedQuantitySql` sets out: a column object would be re-aliased inside a
 * relational query, and drizzle binds a JS array as a record, so
 * `= any(${ids}::uuid[])` fails with "cannot cast type record to uuid[]".
 */
function excludeSql(ids: string[] | undefined): SQL {
  if (!ids || ids.length === 0) return sql``;

  return sql` and we.id not in (${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )})`;
}
