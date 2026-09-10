import { Injectable } from "@nestjs/common";
import type {
  AdminWaitlistAllocationOpen,
  AdminWaitlistAllocationResize,
  AdminWaitlistAllocationView,
} from "@sakura/contracts";
import { AuditService } from "../../audit";
import { DbService } from "../../db/db.service";
import { WaitlistAllocationService } from "../../waitlist";
import type { AdminContext } from "../orders";

/**
 * Opening and closing stock releases, over the admin panel.
 *
 * A thin seam on purpose. `WaitlistAllocationService` owns what a release
 * *means* — the budget arithmetic, the one-open-per-book rule — and is shared
 * with the invite path, which has to agree with this screen to the copy. This
 * class adds only what an admin action needs on top: a transaction, and an
 * audit row saying who decided.
 *
 * The audit entries are not decoration. "Who gave the queue 50 of these 60,
 * and when" is the question asked the morning a customer complains they were
 * told sold-out while a friend got a link, and neither the release row nor the
 * invites can answer it once the release has been closed and reopened twice.
 */
@Injectable()
export class AdminWaitlistAllocationService {
  constructor(
    private readonly dbService: DbService,
    private readonly waitlistAllocationService: WaitlistAllocationService,
    private readonly auditService: AuditService,
  ) {}

  /** The open release for a book plus everything it has had before. */
  async view(bookId: string): Promise<AdminWaitlistAllocationView> {
    const [open, history] = await Promise.all([
      this.waitlistAllocationService.describe(bookId),
      this.waitlistAllocationService.history(bookId),
    ]);

    return {
      open: open
        ? {
            id: open.id,
            bookId: open.bookId,
            copies: open.copies,
            stockSnapshot: open.stockSnapshot,
            stockQuantity: open.stockQuantity,
            note: open.note,
            committed: open.committed,
            remaining: open.remaining,
            spendable: open.spendable,
            overIssued: open.overIssued,
            openedAt: open.openedAt.toISOString(),
            openedByEmail: open.openedByEmail,
          }
        : null,
      history: history.map((row) => ({
        id: row.id,
        copies: row.copies,
        stockSnapshot: row.stockSnapshot,
        note: row.note,
        status: row.status,
        committed: row.committed,
        sold: row.sold,
        openedAt: row.openedAt.toISOString(),
        openedByEmail: row.openedByEmail,
        closedAt: row.closedAt?.toISOString() ?? null,
        closedByEmail: row.closedByEmail,
      })),
    };
  }

  async open(
    request: AdminWaitlistAllocationOpen,
    context: AdminContext,
  ): Promise<AdminWaitlistAllocationView> {
    const id = await this.dbService.db.transaction((tx) =>
      this.waitlistAllocationService.open(
        request,
        { id: context.actor.sub, email: context.actor.email },
        tx,
      ),
    );

    await this.auditService.recordDetached({
      actor: { sub: context.actor.sub, email: context.actor.email },
      action: "CREATE",
      entityType: "waitlist_allocation",
      entityId: id,
      after: { bookId: request.bookId, copies: request.copies, note: request.note ?? null },
      note: `Allocated ${request.copies} cop${request.copies === 1 ? "y" : "ies"} to the waitlist.`,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return this.view(request.bookId);
  }

  /**
   * Change how many copies an open release gives the queue.
   *
   * Audited as an UPDATE carrying both numbers, because "who cut the queue's
   * share from fifty to thirty, and when" is the question the morning after —
   * and the release row itself cannot answer it, holding only the number it
   * ended at.
   */
  async resize(
    id: string,
    bookId: string,
    request: AdminWaitlistAllocationResize,
    context: AdminContext,
  ): Promise<AdminWaitlistAllocationView> {
    const before = await this.waitlistAllocationService.describe(bookId);

    await this.dbService.db.transaction((tx) =>
      this.waitlistAllocationService.resize(id, request.copies, tx, request.note),
    );

    await this.auditService.recordDetached({
      actor: { sub: context.actor.sub, email: context.actor.email },
      action: "UPDATE",
      entityType: "waitlist_allocation",
      entityId: id,
      before: before ? { copies: before.copies } : undefined,
      after: { copies: request.copies },
      note:
        before && before.copies !== request.copies
          ? `Changed the waitlist's share from ${before.copies} to ${request.copies}.`
          : `Set the waitlist's share to ${request.copies}.`,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return this.view(bookId);
  }

  /**
   * Close a release. Takes `bookId` alongside the id purely so the response can
   * be the same view the panel already renders — closing one release and
   * immediately seeing the book's state is one round trip rather than two.
   */
  async close(
    id: string,
    bookId: string,
    context: AdminContext,
  ): Promise<AdminWaitlistAllocationView> {
    await this.dbService.db.transaction((tx) =>
      this.waitlistAllocationService.close(
        id,
        { id: context.actor.sub, email: context.actor.email },
        tx,
      ),
    );

    await this.auditService.recordDetached({
      actor: { sub: context.actor.sub, email: context.actor.email },
      action: "UPDATE",
      entityType: "waitlist_allocation",
      entityId: id,
      after: { status: "CLOSED" },
      /* Worth spelling out in the log, because it is the most common
         misreading of the button: closing stops new invites and leaves the
         live ones alone. */
      note: "Closed the stock release. Invites already issued keep their windows.",
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return this.view(bookId);
  }
}
