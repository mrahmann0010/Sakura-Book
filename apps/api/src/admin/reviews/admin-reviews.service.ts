import { Injectable } from "@nestjs/common";
import type {
  AdminReview,
  AdminReviewCounts,
  AdminReviewList,
  AdminReviewQuery,
  AdminReviewUpdateRequest,
} from "@sakura/contracts";
import { eq, sql } from "drizzle-orm";
import { AuditService } from "../../audit";
import { InvalidInputError, ResourceNotFoundError } from "../../common/errors";
import { DbService } from "../../db/db.service";
import { initialReviews, orders } from "../../db/schema";
import type { AdminContext } from "../orders";
import { toAdminReview, type AdminReviewRow } from "./admin-reviews.mapper";
import { adminReviewFilters, adminReviewOrder } from "./admin-reviews.query";

/**
 * The moderation desk.
 *
 * `POST /reviews` has been filling a table nothing publishes. This service is
 * the other half: what came in, and the single action — a status change —
 * that decides whether any of it is ever seen.
 *
 * ## What it does not do
 *
 * It does not edit the testimonial. `body`, `title` and `authorName` are
 * absent from the update contract on purpose: declining to publish something
 * is moderation, and rewriting someone's words and publishing the result under
 * their name is not. Rejection carries a `moderatorNote` so the reason lives
 * somewhere other than memory.
 *
 * It does not touch the catalog. These testimonials are about the service and
 * feed no book's rating, so approving one is a single UPDATE with no rollup to
 * recalculate and no second step to forget.
 */
@Injectable()
export class AdminReviewsService {
  constructor(
    private readonly dbService: DbService,
    private readonly auditService: AuditService,
  ) {}

  /** The columns a row needs, joined to the order a moderator linked. */
  private get selection() {
    return {
      id: initialReviews.id,
      authorName: initialReviews.authorName,
      authorEmail: initialReviews.authorEmail,
      rating: initialReviews.rating,
      title: initialReviews.title,
      body: initialReviews.body,
      status: initialReviews.status,
      isFeatured: initialReviews.isFeatured,
      isVerified: initialReviews.isVerified,
      moderatorNote: initialReviews.moderatorNote,
      publishedAt: initialReviews.publishedAt,
      createdAt: initialReviews.createdAt,
      ipHash: initialReviews.ipHash,
      userAgent: initialReviews.userAgent,
      /* Left join: `orderId` is null on every testimonial nobody has linked to
         an order, which is most of them, and an inner join would drop them. */
      orderNumber: orders.orderNumber,
    };
  }

  private baseQuery() {
    return this.dbService.db
      .select(this.selection)
      .from(initialReviews)
      .leftJoin(orders, eq(initialReviews.orderId, orders.id));
  }

  async list(query: AdminReviewQuery): Promise<AdminReviewList> {
    const where = adminReviewFilters(query);
    const offset = (query.page - 1) * query.pageSize;

    const [rows, [{ total }], counts] = await Promise.all([
      this.baseQuery()
        .where(where)
        .orderBy(...adminReviewOrder(query.sort))
        .limit(query.pageSize)
        .offset(offset),

      this.dbService.db
        .select({ total: sql<number>`count(*)::int` })
        .from(initialReviews)
        .where(where),

      this.statusCounts(query),
    ]);

    return {
      items: rows.map((row) => toAdminReview(row as AdminReviewRow)),
      total,
      page: query.page,
      totalPages: Math.ceil(total / query.pageSize),
      counts,
    };
  }

  /**
   * How many rows sit in each status under the *current* filters, ignoring
   * the status filter itself — so the tabs count the search rather than the
   * table. One grouped query rather than four counts.
   */
  private async statusCounts(query: AdminReviewQuery): Promise<AdminReviewCounts> {
    const rows = await this.dbService.db
      .select({ status: initialReviews.status, count: sql<number>`count(*)::int` })
      .from(initialReviews)
      .where(adminReviewFilters(query, { skipStatus: true }))
      .groupBy(initialReviews.status);

    /* Zeroed first: a status with no rows is absent from a GROUP BY result,
       and a tab rendering "undefined" for an empty state is worse than 0. */
    const counts: AdminReviewCounts = { PENDING: 0, APPROVED: 0, REJECTED: 0, SPAM: 0 };
    for (const row of rows) counts[row.status] = row.count;

    return counts;
  }

  /**
   * Moderate one testimonial: publish it, bin it, or annotate it.
   *
   * `publishedAt` is derived here rather than accepted, and it is the reason
   * this method exists at all. The table's check constraint makes "approved"
   * and "has a publish date" the same fact, so the two must move together:
   * approving stamps the date, and anything else clears it. A testimonial
   * pulled back to PENDING and re-approved is re-dated deliberately — it is
   * going live now, and dating it from a first approval it never had would put
   * it below ones it should lead.
   */
  async update(
    id: string,
    request: AdminReviewUpdateRequest,
    context: AdminContext,
  ): Promise<AdminReview> {
    const existing = await this.dbService.db.query.initialReviews.findFirst({
      where: eq(initialReviews.id, id),
      columns: {
        id: true,
        status: true,
        isFeatured: true,
        isVerified: true,
        orderId: true,
        moderatorNote: true,
      },
    });

    if (!existing) throw new ResourceNotFoundError("Testimonial");

    const nextStatus = request.status ?? existing.status;

    /* Resolved before the update rather than inside it: a `null` here means
       "clear the link" and a string means "resolve it", and mixing an await
       into the object literal made an empty string — which the contract
       permits — fall through as an id and reach Postgres as a failed uuid
       cast. */
    const orderId =
      request.orderNumber === undefined
        ? undefined
        : request.orderNumber
          ? await this.requireOrder(request.orderNumber)
          : null;

    await this.dbService.db
      .update(initialReviews)
      .set({
        ...(request.status === undefined
          ? {}
          : {
              status: request.status,
              publishedAt: request.status === "APPROVED" ? new Date() : null,
            }),
        ...(request.isFeatured === undefined ? {} : { isFeatured: request.isFeatured }),
        ...(request.isVerified === undefined ? {} : { isVerified: request.isVerified }),
        ...(orderId === undefined ? {} : { orderId }),
        ...(request.moderatorNote === undefined
          ? {}
          : // Empty string clears it: a note trimmed to nothing is not a note,
            // and storing "" would make `hasNote`-style checks lie.
            { moderatorNote: request.moderatorNote.trim() || null }),
        updatedAt: new Date(),
      })
      .where(eq(initialReviews.id, id));

    /*
     * Audited because this is the one place a member of the public's words
     * become something the shop published under its own banner — "who
     * approved that" is a question that gets asked exactly once, on the day
     * it matters. Detached rather than in the transaction: the moderation
     * decision must not roll back because the audit writer had a bad moment.
     */
    await this.auditService.recordDetached({
      actor: { sub: context.actor.sub, email: context.actor.email },
      action: "UPDATE",
      entityType: "initial_review",
      entityId: id,
      before: {
        status: existing.status,
        isFeatured: existing.isFeatured,
        isVerified: existing.isVerified,
        moderatorNote: existing.moderatorNote,
      },
      after: request,
      note: request.status ? `Testimonial moved to ${nextStatus}.` : undefined,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    const [row] = await this.baseQuery().where(eq(initialReviews.id, id));

    return toAdminReview(row as AdminReviewRow);
  }

  /**
   * Delete one testimonial outright.
   *
   * Kept alongside `SPAM` rather than replaced by it, and the two are for
   * different things: `SPAM` is the record that a bot posted, which is what
   * makes the `ipHash` index worth having. This is for the submission that
   * must not remain on disk at all — the one containing someone's phone
   * number, or a request to be forgotten.
   */
  async remove(id: string, context: AdminContext): Promise<void> {
    const [deleted] = await this.dbService.db
      .delete(initialReviews)
      .where(eq(initialReviews.id, id))
      .returning({ id: initialReviews.id, status: initialReviews.status });

    if (!deleted) throw new ResourceNotFoundError("Testimonial");

    await this.auditService.recordDetached({
      actor: { sub: context.actor.sub, email: context.actor.email },
      action: "DELETE",
      entityType: "initial_review",
      entityId: id,
      before: { status: deleted.status },
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
  }


  /** The order backing a verified badge, looked up by the number staff can
   *  actually see on a receipt rather than by an id nobody quotes. */
  private async requireOrder(orderNumber: string): Promise<string> {
    const order = await this.dbService.db.query.orders.findFirst({
      where: eq(orders.orderNumber, orderNumber),
      columns: { id: true },
    });

    if (!order) {
      throw new InvalidInputError("No order with that number.", { orderNumber });
    }

    return order.id;
  }
}
