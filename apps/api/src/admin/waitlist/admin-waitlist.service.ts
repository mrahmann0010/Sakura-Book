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
import { and, eq, inArray, sql } from "drizzle-orm";
import { AuditService } from "../../audit";
import { ResourceNotFoundError } from "../../common/errors";
import { DbService } from "../../db/db.service";
import { orders, waitlistEntries } from "../../db/schema";
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
 * It does not set `convertedOrderId` either. Linking a signup to the order it
 * became needs a matching rule — phone equality is the obvious one and is
 * wrong for a household sharing a number — and that is a decision about the
 * business, not a default worth inventing here. The column and its display
 * are ready for whatever rule you choose.
 */
@Injectable()
export class AdminWaitlistService {
  constructor(
    private readonly dbService: DbService,
    private readonly auditService: AuditService,
  ) {}

  /** The columns a row needs, joined to the order it converted into. */
  private get selection() {
    return {
      id: waitlistEntries.id,
      bookTitleSnapshot: waitlistEntries.bookTitleSnapshot,
      customerName: waitlistEntries.customerName,
      customerEmail: waitlistEntries.customerEmail,
      customerPhone: waitlistEntries.customerPhone,
      quantity: waitlistEntries.quantity,
      locale: waitlistEntries.locale,
      source: waitlistEntries.source,
      status: waitlistEntries.status,
      notifiedAt: waitlistEntries.notifiedAt,
      internalNote: waitlistEntries.internalNote,
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

      this.statusCounts(query),
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
   * How many entries sit in each status under the *current* filters, ignoring
   * the status filter itself — so the tabs count the search rather than the
   * table. One grouped query rather than four counts.
   */
  private async statusCounts(query: AdminWaitlistQuery): Promise<AdminWaitlistCounts> {
    const rows = await this.dbService.db
      .select({ status: waitlistEntries.status, count: sql<number>`count(*)::int` })
      .from(waitlistEntries)
      .where(adminWaitlistFilters(query, { skipStatus: true }))
      .groupBy(waitlistEntries.status);

    /* Zeroed first: a status with no rows is absent from a GROUP BY result,
       and a tab that renders "undefined" for an empty state is worse than one
       that renders 0. */
    const counts: AdminWaitlistCounts = { PENDING: 0, NOTIFIED: 0, CONVERTED: 0, CANCELLED: 0 };
    for (const row of rows) counts[row.status] = row.count;

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
   */
  async update(
    id: string,
    request: AdminWaitlistUpdateRequest,
    context: AdminContext,
  ): Promise<AdminWaitlistEntry> {
    const existing = await this.dbService.db.query.waitlistEntries.findFirst({
      where: eq(waitlistEntries.id, id),
      columns: { id: true, status: true, internalNote: true },
    });

    if (!existing) throw new ResourceNotFoundError("Waitlist entry");

    await this.dbService.db
      .update(waitlistEntries)
      .set({
        ...(request.status === undefined ? {} : { status: request.status }),
        ...(request.internalNote === undefined
          ? {}
          : // Empty string clears it: a note trimmed to nothing is not a note,
            // and storing "" would make `hasNote`-style checks lie.
            { internalNote: request.internalNote.trim() || null }),
        updatedAt: new Date(),
      })
      .where(eq(waitlistEntries.id, id));

    await this.auditService.recordDetached({
      actor: { sub: context.actor.sub, email: context.actor.email },
      action: "UPDATE",
      entityType: "waitlist_entry",
      entityId: id,
      before: { status: existing.status, internalNote: existing.internalNote },
      after: {
        ...(request.status === undefined ? {} : { status: request.status }),
        ...(request.internalNote === undefined ? {} : { internalNote: request.internalNote }),
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
}

/** See `exportCsv`. Well above this shop's plausible waitlist; the filters
 *  are the answer if it is ever not. */
const EXPORT_LIMIT = 10_000;
