import { Injectable } from "@nestjs/common";
import type {
  AdminWaitlistCounts,
  AdminWaitlistEntry,
  AdminWaitlistList,
  AdminWaitlistNotifyRequest,
  AdminWaitlistNotifyResult,
  AdminWaitlistQuery,
  AdminWaitlistUpdateRequest,
} from "@sakura/contracts";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { AuditService } from "../../audit";
import { InvalidInputError, ResourceNotFoundError } from "../../common/errors";
import { DbService } from "../../db/db.service";
import { books, orders, waitlistEntries } from "../../db/schema";
import { toE164Bd } from "../../sms/phone";
import { WaitlistInviteService, waitlistLaneSql } from "../../waitlist";
import type { AdminContext } from "../orders";
import { toAdminWaitlistEntry, toWaitlistCsv, type WaitlistRow } from "./admin-waitlist.mapper";
import { adminWaitlistFilters, adminWaitlistOrder } from "./admin-waitlist.query";

/**
 * The waitlist desk.
 *
 * ## What this is for
 *
 * `POST /waitlist` has been filling a table nothing reads. This service is
 * the other half: who is waiting, in what language, and — once stock lands —
 * who has actually been told. Without it `status` and `notifiedAt` are
 * columns with no lifecycle, and the only way to work the list is a SQL
 * client.
 *
 * ## What it deliberately does not do
 *
 * It does not send anything. "Notified" here means *staff sent the message*,
 * recorded after the fact, because the messages go out through bKash-adjacent
 * SMS tooling and a Messenger thread rather than through this API. A button
 * that claimed to send would be a button that lies the first time the gateway
 * is down, and an audit trail that records an intention rather than an event.
 *
 * It does not set `convertedOrderId` either — it only displays it. That link
 * is written by `CheckoutService`, in the transaction that creates the order,
 * for the one case where the connection is a fact rather than a guess: the
 * customer arrived holding an invite token, so the entry is known exactly. An
 * order placed by someone who was on the list but never used their link stays
 * unlinked, because matching it back would need a rule — phone equality is
 * the obvious one and is wrong for a household sharing a number — and that is
 * a decision about the business, not a default worth inventing here.
 */
@Injectable()
export class AdminWaitlistService {
  constructor(
    private readonly dbService: DbService,
    private readonly auditService: AuditService,
    private readonly waitlistInviteService: WaitlistInviteService,
  ) {}

  /** The columns a row needs, joined to the order it converted into. */
  private get selection() {
    return {
      id: waitlistEntries.id,
      bookId: waitlistEntries.bookId,
      bookTitleSnapshot: waitlistEntries.bookTitleSnapshot,
      customerName: waitlistEntries.customerName,
      customerEmail: waitlistEntries.customerEmail,
      customerPhone: waitlistEntries.customerPhone,
      quantity: waitlistEntries.quantity,
      locale: waitlistEntries.locale,
      source: waitlistEntries.source,
      status: waitlistEntries.status,
      /* Computed by Postgres in the same statement that reads the row, so the
         tab a row renders under and the tab it was counted under are the same
         answer from the same clock. See `waitlist/waitlist-lane.ts`. */
      lane: waitlistLaneSql(),
      notifiedAt: waitlistEntries.notifiedAt,
      internalNote: waitlistEntries.internalNote,
      inviteSmsStatus: waitlistEntries.inviteSmsStatus,
      inviteSmsError: waitlistEntries.inviteSmsError,
      inviteSmsAt: waitlistEntries.inviteSmsAt,
      /* The token's lifecycle, never the token. See the mapper. */
      inviteMode: waitlistEntries.inviteMode,
      inviteExpiresAt: waitlistEntries.inviteExpiresAt,
      inviteUsedAt: waitlistEntries.inviteUsedAt,
      createdAt: waitlistEntries.createdAt,
      /* Left join: `converted_order_id` is nullable and the order it points
         at may have been deleted, and neither case should drop the waitlist
         entry from the list. */
      convertedOrderNumber: orders.orderNumber,
    };
  }

  async list(query: AdminWaitlistQuery): Promise<AdminWaitlistList> {
    const where = adminWaitlistFilters(query);
    const offset = (query.page - 1) * query.pageSize;

    const [rows, [{ total, totalQuantity }], counts, sources] = await Promise.all([
      this.dbService.db
        .select(this.selection)
        .from(waitlistEntries)
        .leftJoin(orders, eq(waitlistEntries.convertedOrderId, orders.id))
        .where(where)
        .orderBy(...adminWaitlistOrder(query.sort))
        .limit(query.pageSize)
        .offset(offset),

      this.dbService.db
        .select({
          total: sql<number>`count(*)::int`,
          totalQuantity: sql<number>`coalesce(sum(${waitlistEntries.quantity}), 0)::int`,
        })
        .from(waitlistEntries)
        .where(where),

      this.laneCounts(query),
      this.distinctSources(),
    ]);

    return {
      items: rows.map((row) => toAdminWaitlistEntry(row as WaitlistRow)),
      total,
      page: query.page,
      totalPages: Math.ceil(total / query.pageSize),
      counts,
      totalQuantity,
      sources,
    };
  }

  /**
   * How many entries sit in each lane under the *current* filters, ignoring
   * the lane filter itself — so the tabs count the search rather than the
   * table. One grouped query rather than five counts.
   *
   * Grouped by the lane expression itself rather than by `status`, which is
   * the whole reason this changed: every expired entry is `NOTIFIED`, so a
   * status-keyed group could not put a number on the Expired tab at all.
   */
  private async laneCounts(query: AdminWaitlistQuery): Promise<AdminWaitlistCounts> {
    const lane = waitlistLaneSql();

    const rows = await this.dbService.db
      .select({ lane, count: sql<number>`count(*)::int` })
      .from(waitlistEntries)
      .where(adminWaitlistFilters(query, { skipLane: true }))
      .groupBy(lane);

    /* Zeroed first: a lane with no rows is absent from a GROUP BY result, and
       a tab that renders "undefined" for an empty state is worse than one
       that renders 0. */
    const counts: AdminWaitlistCounts = {
      WAITING: 0,
      INVITED: 0,
      EXPIRED: 0,
      ORDERED: 0,
      CONVERTED: 0,
      CANCELLED: 0,
    };
    for (const row of rows) counts[row.lane] = row.count;

    return counts;
  }

  private async distinctSources(): Promise<string[]> {
    const rows = await this.dbService.db
      .selectDistinct({ source: waitlistEntries.source })
      .from(waitlistEntries)
      .orderBy(waitlistEntries.source);

    return rows.map((row) => row.source);
  }

  /**
   * Every entry matching the filters, as a CSV — no pagination.
   *
   * This is how the restock announcement actually gets sent: the list leaves
   * here and goes into whatever bulk SMS tool is to hand. Capped at
   * EXPORT_LIMIT rows so one request cannot try to render the whole table
   * into memory as a string; the cap is far above any plausible waitlist for
   * this shop, and the filters are there for when it is not.
   */
  async exportCsv(query: AdminWaitlistQuery): Promise<string> {
    const rows = await this.dbService.db
      .select(this.selection)
      .from(waitlistEntries)
      .leftJoin(orders, eq(waitlistEntries.convertedOrderId, orders.id))
      .where(adminWaitlistFilters(query))
      .orderBy(...adminWaitlistOrder(query.sort))
      .limit(EXPORT_LIMIT);

    return toWaitlistCsv(rows.map((row) => toAdminWaitlistEntry(row as WaitlistRow)));
  }

  /**
   * Record that the restock message went out to these entries.
   *
   * Only `PENDING` rows move. Re-selecting someone who was already notified
   * is not an error and does not re-stamp their `notifiedAt` — the timestamp
   * answers "when were they first told", which is what makes "notified four
   * days ago and still has not ordered" a question you can ask. The result
   * reports how many actually moved so the panel can say so plainly rather
   * than implying it messaged forty people when it moved six.
   *
   * CANCELLED and CONVERTED are excluded by the same condition, deliberately:
   * someone who asked to be taken off the list should not be marked as having
   * been contacted, and someone who already bought does not need telling.
   */
  async notify(
    request: AdminWaitlistNotifyRequest,
    context: AdminContext,
  ): Promise<AdminWaitlistNotifyResult> {
    const notifiedAt = new Date();

    const updated = await this.dbService.db
      .update(waitlistEntries)
      .set({ status: "NOTIFIED", notifiedAt, updatedAt: notifiedAt })
      .where(and(inArray(waitlistEntries.id, request.ids), eq(waitlistEntries.status, "PENDING")))
      .returning({ id: waitlistEntries.id });

    /* One entry for the batch rather than one per row: the action staff took
       was "I messaged these forty people", and forty audit rows describing it
       would bury the log the day the list is actually worked. */
    if (updated.length > 0) {
      await this.auditService.recordDetached({
        actor: { sub: context.actor.sub, email: context.actor.email },
        action: "UPDATE",
        entityType: "waitlist_entry",
        after: {
          status: "NOTIFIED",
          notifiedAt: notifiedAt.toISOString(),
          ids: updated.map((row) => row.id),
        },
        note: `Marked ${updated.length} waitlist entr${updated.length === 1 ? "y" : "ies"} as notified.`,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
    }

    return { updated: updated.length, notifiedAt: notifiedAt.toISOString() };
  }

  /**
   * Edit one entry: its status, its staff note, or both.
   *
   * This is the only route to CANCELLED, which is what someone asking to be
   * taken off the list becomes. A delete would lose the fact that they asked,
   * and the partial unique index on phone would then happily let a
   * re-subscribe slip through as if nothing had happened.
   *
   * Cancelling also takes back any unspent invite, in the same transaction —
   * see below. That is the one place this service touches the token
   * lifecycle, and it does it through `WaitlistInviteService` rather than by
   * writing the columns itself.
   */
  async update(
    id: string,
    request: AdminWaitlistUpdateRequest,
    context: AdminContext,
  ): Promise<AdminWaitlistEntry> {
    const existing = await this.dbService.db.query.waitlistEntries.findFirst({
      where: eq(waitlistEntries.id, id),
      columns: {
        id: true,
        status: true,
        internalNote: true,
        bookId: true,
        bookTitleSnapshot: true,
        quantity: true,
        customerName: true,
        customerEmail: true,
        customerPhone: true,
        locale: true,
        inviteUsedAt: true,
        inviteExpiresAt: true,
        fulfillingOrderId: true,
      },
    });

    if (!existing) throw new ResourceNotFoundError("Waitlist entry");

    /* The details, worked out before the transaction: what they normalize to,
       what the title snapshot becomes, and whether the entry is in a state
       where changing them is honest at all. */
    const details = await this.resolveDetails(id, request, existing);

    /* One transaction because cancelling is two writes that mean one thing.
       Moving an entry to CANCELLED without taking its invite back leaves the
       shop holding copies for someone it has just removed from the list — and
       leaves that person a link that still works, since `consume` reads the
       token, never the status. Committing the status change alone would be
       the same bug with a smaller window. */
    await this.dbService.db.transaction(async (tx) => {
      await tx
        .update(waitlistEntries)
        .set({
          ...(request.status === undefined ? {} : { status: request.status }),
          ...(request.internalNote === undefined
            ? {}
            : // Empty string clears it: a note trimmed to nothing is not a note,
              // and storing "" would make `hasNote`-style checks lie.
              { internalNote: request.internalNote.trim() || null }),
          ...details,
          updatedAt: new Date(),
        })
        .where(eq(waitlistEntries.id, id));

      /* Unconditional on the *previous* status: an entry can be cancelled
         from PENDING (never invited, nothing to revoke — `revoke` is a no-op
         there) or from NOTIFIED (invited, and this is the whole point). Asking
         which it was would only add a branch that has to stay right. */
      if (request.status === "CANCELLED") {
        await this.waitlistInviteService.revoke(id, tx);
      }

      /* Moving a lapsed entry to another title takes its dead invite with it.
         `resolveDetails` has already refused the live and spent cases, so what
         is left here is a token nobody can redeem — but one that still points
         at the *old* book's release and wave. Carrying that across would leave
         a row charged to a budget for a book it is no longer waiting on, and
         the Expired tab offering a re-invite that re-reads it. */
      if (details.bookId !== undefined && details.bookId !== existing.bookId) {
        await this.waitlistInviteService.revoke(id, tx);
      }
    });

    await this.auditService.recordDetached({
      actor: { sub: context.actor.sub, email: context.actor.email },
      action: "UPDATE",
      entityType: "waitlist_entry",
      entityId: id,
      /* The whole editable surface on both sides, not just the fields this
         request touched. An entry's book, quantity and contact details are now
         staff-editable, and "who changed this number, and from what" is the
         question the log has to be able to answer afterwards. */
      before: {
        status: existing.status,
        internalNote: existing.internalNote,
        bookId: existing.bookId,
        bookTitleSnapshot: existing.bookTitleSnapshot,
        quantity: existing.quantity,
        customerName: existing.customerName,
        customerEmail: existing.customerEmail,
        customerPhone: existing.customerPhone,
        locale: existing.locale,
      },
      after: {
        ...(request.status === undefined ? {} : { status: request.status }),
        ...(request.internalNote === undefined ? {} : { internalNote: request.internalNote }),
        ...details,
      },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    const [row] = await this.dbService.db
      .select(this.selection)
      .from(waitlistEntries)
      .leftJoin(orders, eq(waitlistEntries.convertedOrderId, orders.id))
      .where(eq(waitlistEntries.id, id));

    return toAdminWaitlistEntry(row as WaitlistRow);
  }

  /**
   * The detail half of a PATCH, checked and normalized into columns.
   *
   * Returns only the fields the request actually sent, so the caller can spread
   * it into an update alongside the status/note half without having to know
   * which of the two wrote what.
   *
   * ## Why the book and the quantity are guarded and the rest are not
   *
   * Name, email, phone and language describe how to reach somebody. Getting one
   * wrong wastes a text; correcting one costs the shop nothing, whatever state
   * the entry is in.
   *
   * The book and the quantity are different: together they *are* the hold. A
   * live invite reserves `quantity` copies of `bookId` against that book's open
   * release (see `reservedQuantitySql` and `committedSql`, both of which read
   * these columns straight off the row). Editing either under a live invite
   * silently moves copies between budgets — raise a 2 to a 5 and the release is
   * over-issued by three with nothing on screen to say so; change the book and
   * one release goes on being charged for copies of a title the entry has
   * stopped waiting on. So the edit is refused while a hold is live, with the
   * one instruction that makes it possible: take the invite back first.
   *
   * A spent invite is refused outright and for a plainer reason — the entry
   * became an order, and the record of what somebody bought is not a form.
   */
  private async resolveDetails(
    id: string,
    request: AdminWaitlistUpdateRequest,
    existing: {
      bookId: string | null;
      customerPhone: string;
      status: AdminWaitlistEntry["status"];
      inviteUsedAt: Date | null;
      inviteExpiresAt: Date | null;
      fulfillingOrderId: string | null;
    },
  ): Promise<Partial<typeof waitlistEntries.$inferInsert>> {
    const details: Partial<typeof waitlistEntries.$inferInsert> = {};

    if (request.customerName !== undefined) details.customerName = request.customerName;
    if (request.customerEmail !== undefined) details.customerEmail = request.customerEmail;
    if (request.locale !== undefined) details.locale = request.locale;

    /* Stored in the same shape the signup door stores it, because everything
       downstream — the dedupe index, the SMS gateway, a staff member searching
       for a number a customer just read out — assumes one spelling. */
    const phone = request.customerPhone === undefined ? null : toE164Bd(request.customerPhone);
    if (phone !== null) details.customerPhone = phone;

    const movingBook = request.bookId !== undefined && request.bookId !== existing.bookId;
    const changingHold = movingBook || request.quantity !== undefined;

    if (changingHold) {
      if (existing.inviteUsedAt !== null || existing.status === "CONVERTED") {
        throw new InvalidInputError(
          "This entry has already become an order. Its book and quantity are the record of what was bought.",
        );
      }

      if (existing.inviteExpiresAt !== null && existing.inviteExpiresAt > new Date()) {
        throw new InvalidInputError(
          "This entry is holding a copy. Remove it from the list to take the invite back, restore it, then change the book or quantity.",
        );
      }

      /* The third way a book and quantity can already be spoken for, and the
         one with no token behind it to look at: this customer has placed an
         order for this book and the shop is waiting to be paid. Moving the
         entry to another title would leave it linked to an order that does not
         contain that title — and the link is what converts it when the money
         lands, so the row would eventually record a sale of a book nobody
         bought. Refused rather than silently unlinked, because which of the two
         is wrong is a question only the person at the desk can answer. */
      if (existing.fulfillingOrderId !== null) {
        throw new InvalidInputError(
          "This customer has an order for this book waiting on payment. Settle or cancel that order before changing the book or quantity.",
        );
      }
    }

    if (request.quantity !== undefined) details.quantity = request.quantity;

    if (request.bookId !== undefined) {
      /* The snapshot is written here, never accepted from the caller — same
         rule as the storefront's signup, and for the same reason: the title a
         browser had on screen is not the catalog's answer. Both columns move
         together or the row starts claiming one book and displaying another. */
      if (request.bookId === null) {
        details.bookId = null;
        details.bookTitleSnapshot = null;
      } else {
        const book = await this.dbService.db.query.books.findFirst({
          where: eq(books.id, request.bookId),
          columns: { id: true, title: true },
        });

        if (!book) throw new ResourceNotFoundError("Book", request.bookId);

        details.bookId = book.id;
        details.bookTitleSnapshot = book.title;
      }
    }

    /* Checked here rather than left to the partial unique index, which fires
       the same rule as an opaque 409 naming a constraint. Both halves of that
       index are in play: a phone edit can collide on the entry's existing book,
       and a book edit can collide on its existing phone. */
    if (phone !== null || movingBook) {
      await this.assertNotAlreadyWaiting(
        id,
        phone ?? existing.customerPhone,
        request.bookId === undefined ? existing.bookId : request.bookId,
      );
    }

    return details;
  }

  /** The other live entry this phone already has for this book, if any — see
   *  `waitlist_entries_phone_book_idx` for why CONVERTED is excluded. */
  private async assertNotAlreadyWaiting(
    id: string,
    phone: string,
    bookId: string | null,
  ): Promise<void> {
    const clash = await this.dbService.db.query.waitlistEntries.findFirst({
      where: and(
        eq(waitlistEntries.customerPhone, phone),
        bookId === null ? isNull(waitlistEntries.bookId) : eq(waitlistEntries.bookId, bookId),
        ne(waitlistEntries.status, "CONVERTED"),
        ne(waitlistEntries.id, id),
      ),
      columns: { id: true, customerName: true },
    });

    if (clash) {
      throw new InvalidInputError(
        `${clash.customerName} is already on this book's list with that number. Edit that entry instead.`,
      );
    }
  }
}

/** See `exportCsv`. Well above this shop's plausible waitlist; the filters
 *  are the answer if it is ever not. */
const EXPORT_LIMIT = 10_000;
