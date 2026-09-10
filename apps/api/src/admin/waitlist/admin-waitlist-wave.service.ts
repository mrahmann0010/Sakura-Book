import { Injectable } from "@nestjs/common";
import type { AdminWaitlistInviteResult, AdminWaitlistWaveRequest } from "@sakura/contracts";
import { and, asc, eq, sql } from "drizzle-orm";
import { InvalidInputError } from "../../common/errors";
import { DbService } from "../../db/db.service";
import { waitlistEntries, waitlistInviteWaves } from "../../db/schema";
import {
  WaitlistAllocationService,
  WaitlistInviteSettingsService,
  waitlistLaneFilterSql,
} from "../../waitlist";
import type { AdminContext } from "../orders";
import { AdminWaitlistInviteService } from "./admin-waitlist-invite.service";

/**
 * Sending a wave: walk the queue in order and invite exactly as many people as
 * the release can fund.
 *
 * Step 3 of `docs/waitlist-queue-system.md`, and the piece that turns the panel
 * from "select some rows and hope" into the flow the shop actually wants.
 * Staff press one button; this decides who, in what order, and how many.
 *
 * ## Why a person presses the button
 *
 * There is no cron here and that is deliberate. The gateway is one Android
 * phone with one SIM and every message is billed; there is no job runner in
 * this system, since every send today happens inside the request that asked
 * for it; and a restock morning is already a moment somebody is watching. An
 * automatic next wave is a reasonable thing to add later — it is not the thing
 * to build first, and it should never be the thing that discovers the gateway
 * is offline.
 */
@Injectable()
export class AdminWaitlistWaveService {
  constructor(
    private readonly dbService: DbService,
    private readonly waitlistAllocationService: WaitlistAllocationService,
    private readonly waitlistInviteSettingsService: WaitlistInviteSettingsService,
    private readonly adminWaitlistInviteService: AdminWaitlistInviteService,
  ) {}

  /**
   * Who the next wave goes to.
   *
   * Candidates are the WAITING and EXPIRED lanes: not cancelled, not
   * converted, and not currently holding a live link. Someone mid-window has
   * not declined anything yet, and texting them again would spend the release's
   * budget on a copy they are already holding.
   *
   * Filled by walking the fairness order and taking entries while their
   * quantity still fits. Sequentially, in one pass, before a single SMS is
   * sent — the same reason `refuseBeyondAllocation` decides capacity up front:
   * the send loop runs five at a time, and five concurrent capacity checks each
   * see the same remaining budget and each claim it.
   *
   * An entry that does not fit is **skipped, not stopped on**. Somebody asking
   * for five copies with three left should not block the four people behind
   * them who want one each. Skipping is reported rather than silent: an entry
   * that keeps getting passed over is exactly the case that needs a human.
   */
  async plan(bookId: string): Promise<WavePlan> {
    const budget = await this.waitlistAllocationService.describe(bookId);

    if (!budget) {
      throw new InvalidInputError(
        "No open stock release for this book. Open one to decide how many copies the waitlist gets.",
        { bookId },
      );
    }

    const candidates = await this.dbService.db
      .select({
        id: waitlistEntries.id,
        quantity: waitlistEntries.quantity,
        customerName: waitlistEntries.customerName,
        attempts: waitlistEntries.inviteAttempts,
      })
      .from(waitlistEntries)
      .where(
        and(eq(waitlistEntries.bookId, bookId), waitlistLaneFilterSql(["WAITING", "EXPIRED"])),
      )
      .orderBy(
        asc(waitlistEntries.inviteAttempts),
        asc(waitlistEntries.createdAt),
        asc(waitlistEntries.id),
      )
      /* A guard against a pathological queue, not a wave size — the budget is
         what caps the wave. Well above any plausible release for this shop. */
      .limit(1000);

    const ids: string[] = [];
    const skipped: { id: string; name: string; quantity: number }[] = [];
    const quantityById = new Map<string, number>();
    let quantity = 0;

    for (const entry of candidates) {
      if (quantity + entry.quantity > budget.spendable) {
        skipped.push({ id: entry.id, name: entry.customerName, quantity: entry.quantity });
        continue;
      }

      ids.push(entry.id);
      quantityById.set(entry.id, entry.quantity);
      quantity += entry.quantity;
    }

    return {
      allocationId: budget.id,
      spendable: budget.spendable,
      ids,
      quantity,
      quantityById,
      skipped,
      waiting: candidates.length,
    };
  }

  /**
   * Open a wave and send it.
   *
   * The wave row is written **before** the sends, so a batch that dies halfway
   * still has something to attribute its invites to. The counts on it are
   * therefore what was attempted rather than what arrived — the same
   * distinction `invite_sms_status` draws per entry, and the honest one: a wave
   * of fifty whose gateway dropped three still took fifty copies off the
   * budget, because fifty tokens exist.
   *
   * `waveNumber` is derived inside the transaction from what the release
   * already has, and the unique index on (allocation, number) is what makes
   * that safe when two admins press the button at once — the loser gets a
   * constraint violation rather than a duplicate wave 2.
   */
  async send(
    request: AdminWaitlistWaveRequest,
    context: AdminContext,
  ): Promise<AdminWaitlistInviteResult> {
    const plan = await this.plan(request.bookId);

    if (plan.ids.length === 0) {
      throw new InvalidInputError(
        plan.spendable === 0
          ? "This release has no copies left to give out. Wait for an invite to lapse, or allocate more."
          : "Nobody is waiting for this book who is not already holding a link.",
        { bookId: request.bookId, spendable: plan.spendable },
      );
    }

    /* Capped by the plan, never above it: a caller asking for 80 when the
       release can fund 50 gets 50, not an error. The number in the request is
       staff choosing to send *less* than they could — a first small wave to
       check the gateway is awake, say — which is a real thing to want. */
    const ids = request.count ? plan.ids.slice(0, request.count) : plan.ids;

    const ttlHours = await this.waitlistInviteSettingsService.ttlHours();
    const closesAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    const waveId = await this.dbService.db.transaction(async (tx) => {
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${waitlistInviteWaves.waveNumber}), 0) + 1` })
        .from(waitlistInviteWaves)
        .where(eq(waitlistInviteWaves.allocationId, plan.allocationId));

      const [row] = await tx
        .insert(waitlistInviteWaves)
        .values({
          allocationId: plan.allocationId,
          waveNumber: next!,
          invitedCount: ids.length,
          invitedQuantity: ids.reduce(
            (total, id) => total + (plan.quantityById.get(id) ?? 0),
            0,
          ),
          ttlHours,
          closesAt,
          sentById: context.actor.sub,
          sentByEmail: context.actor.email,
        })
        .returning({ id: waitlistInviteWaves.id });

      return row!.id;
    });

    /* Handed to the existing send loop rather than reimplemented here. That
       loop already owns the concurrency cap, the per-attempt delivery record
       and the capacity re-check — and it must stay the only path that issues a
       token, or the two would eventually disagree about what a refusal is. */
    return this.adminWaitlistInviteService.invite({ ids, waveId }, context);
  }
}

export type WavePlan = {
  allocationId: string;
  spendable: number;
  ids: string[];
  quantity: number;
  skipped: { id: string; name: string; quantity: number }[];
  waiting: number;
  quantityById: Map<string, number>;
};
