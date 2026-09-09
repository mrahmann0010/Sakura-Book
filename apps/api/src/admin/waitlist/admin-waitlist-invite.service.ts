import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AdminWaitlistInviteOutcome, AdminWaitlistInviteRequest, AdminWaitlistInviteResult } from "@sakura/contracts";
import { eq, inArray, sql } from "drizzle-orm";
import type { Env } from "../../config/env.schema";
import { AuditService } from "../../audit";
import { DbService } from "../../db/db.service";
import { books, waitlistEntries } from "../../db/schema";
import { reservedQuantitySql } from "../../inventory";
import { SmsService } from "../../sms";
import { WaitlistInviteService, WaitlistInviteSettingsService } from "../../waitlist";
import type { AdminContext } from "../orders";

/**
 * How many invite texts are in flight at once.
 *
 * Deliberately small. The gateway is one phone with one SIM, which serialises
 * internally no matter what we do — so this is not about throughput past a
 * point, it is about not letting the whole batch inherit the latency of every
 * message laid end to end. At five, a 20-person restock finishes in roughly
 * the time four messages take rather than twenty, which keeps the request
 * comfortably inside any proxy's patience even when a send or two hits the
 * gateway timeout. Raising it much further would only queue work inside the
 * phone, where we can neither see it nor time it out.
 */
const INVITE_CONCURRENCY = 5;

/**
 * Issuing invites: the send half of the waitlist, kept apart from
 * `AdminWaitlistService` because that class's own doc comment states it
 * deliberately does not send anything. This is the thing that does.
 *
 * Per entry: mint a token (LOCKED for a per-book entry, reserving the exact
 * book and quantity it waitlisted for; OPEN for the general list, which has
 * no book to lock), text the resulting link, and — only once the text
 * actually sent — move a still-PENDING entry to NOTIFIED. A failed send
 * leaves the token issued (so staff can hand it out another way) but does
 * not claim the entry was reached.
 */
@Injectable()
export class AdminWaitlistInviteService {
  private readonly logger = new Logger(AdminWaitlistInviteService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly waitlistInviteService: WaitlistInviteService,
    private readonly waitlistInviteSettingsService: WaitlistInviteSettingsService,
    private readonly smsService: SmsService,
    private readonly auditService: AuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Decide, before a single text is sent, which of these entries there is
   * actually a copy for.
   *
   * An invite is a promise, and the shop can only keep as many as it has
   * copies. Nothing used to check that: a staff member could select all three
   * hundred people waiting for a sixty-copy print run and send every one of
   * them a working link, and two hundred and forty of them would fill in a
   * checkout form to be told no — after the shop had paid to text each of them.
   *
   * Decided here, in one pass, rather than inside the send loop, because that
   * loop runs five at a time: five concurrent checks against the same book
   * would each see the same remaining capacity and each claim it. Walking the
   * ids sequentially here also means the budget is spent in the order staff
   * selected, which is the order the list is sorted in — first to sign up,
   * first served — rather than in whichever order the gateway answers.
   *
   * Only LOCKED entries are capped. An OPEN invite names no book, so it
   * reserves nothing and there is nothing to run out of.
   */
  private async refuseBeyondStock(
    ids: string[],
    entries: { id: string; status: string; bookId: string | null; quantity: number }[],
  ): Promise<Map<string, string>> {
    const refusals = new Map<string, string>();

    const eligible = ids
      .map((id) => entries.find((row) => row.id === id))
      .filter(
        (entry): entry is (typeof entries)[number] =>
          !!entry && entry.status !== "CANCELLED" && entry.status !== "CONVERTED" && !!entry.bookId,
      );

    const bookIds = [...new Set(eligible.map((entry) => entry.bookId!))];
    if (bookIds.length === 0) return refusals;

    /* Capacity is stock less what everyone *outside this batch* is holding.
       The batch itself is then charged against that below, so re-inviting a
       lapsed entry costs its copies once rather than twice. */
    const rows = await this.dbService.db
      .select({
        id: books.id,
        spare: sql<number>`${books.stockQuantity} - ${reservedQuantitySql(books.id, {
          excludeEntryIds: eligible.map((entry) => entry.id),
        })}`,
      })
      .from(books)
      .where(inArray(books.id, bookIds));

    const budget = new Map(rows.map((row) => [row.id, row.spare]));

    for (const entry of eligible) {
      const bookId = entry.bookId!;
      const remaining = budget.get(bookId) ?? 0;

      if (entry.quantity > remaining) {
        refusals.set(
          entry.id,
          remaining > 0
            ? `Only ${remaining} unreserved ${remaining === 1 ? "copy" : "copies"} left — this entry asks for ${entry.quantity}.`
            : "No unreserved copies left. Print more, or wait for an invite to lapse.",
        );
        continue;
      }

      budget.set(bookId, remaining - entry.quantity);
    }

    return refusals;
  }

  async invite(
    request: AdminWaitlistInviteRequest,
    context: AdminContext,
  ): Promise<AdminWaitlistInviteResult> {
    const entries = await this.dbService.db.query.waitlistEntries.findMany({
      where: inArray(waitlistEntries.id, request.ids),
      columns: {
        id: true,
        status: true,
        bookId: true,
        quantity: true,
        locale: true,
        customerPhone: true,
      },
    });

    const ttlHours = await this.waitlistInviteSettingsService.ttlHours();
    const inviteLanguage = await this.waitlistInviteSettingsService.language();
    const webOrigin = this.config.get("WEB_ORIGIN", { infer: true });

    /* Indexed by position rather than appended, because the sends no longer
       finish in the order they started — see INVITE_CONCURRENCY. The response
       still lists outcomes in the order staff selected them. */
    const results: AdminWaitlistInviteOutcome[] = new Array(request.ids.length);

    const overCapacity = await this.refuseBeyondStock(request.ids, entries);

    await this.eachWithConcurrency(request.ids, INVITE_CONCURRENCY, async (id, index) => {
      const entry = entries.find((row) => row.id === id);

      // Same exclusion `notify()` applies: someone who cancelled or already
      // converted is not a candidate to invite, regardless of what staff
      // selected on screen.
      if (!entry || entry.status === "CANCELLED" || entry.status === "CONVERTED") {
        results[index] = { id, sent: false, mode: null, expiresAt: null, error: "Not eligible." };
        return;
      }

      const refusal = overCapacity.get(id);
      if (refusal) {
        results[index] = { id, sent: false, mode: null, expiresAt: null, error: refusal };
        return;
      }

      const mode = entry.bookId ? "LOCKED" : "OPEN";
      const { token, expiresAt } = await this.waitlistInviteService.issue(entry.id, ttlHours, mode);
      // Kept in step with web's `routes().waitlistInvite` — short because
      // every character here is billed SMS.
      const url = `${webOrigin}/${entry.locale}/invite/${token}`;

      // "customer" defers to whichever locale the entry was submitted under;
      // an explicit "en"/"bn" pins the text regardless. The template only
      // knows English and Bangla, so a third-language signup (e.g. "ja")
      // still reads in English rather than sending nothing.
      const smsLanguage =
        inviteLanguage === "customer" ? (entry.locale === "bn" ? "bn" : "en") : inviteLanguage;

      try {
        await this.smsService.sendInviteLink(entry.customerPhone, url, smsLanguage, ttlHours);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Invite SMS failed for waitlist entry ${entry.id}: ${reason}`);

        /* Written before the response is built, and awaited: this row is the
           only record of the failure that outlives the request. If the tab
           closes or a proxy gives up on the way back, the `results` array
           below is lost and this column is what tells staff who to retry. */
        await this.recordSmsOutcome(entry.id, "FAILED", reason);

        results[index] = {
          id,
          sent: false,
          mode,
          expiresAt: expiresAt.toISOString(),
          error: "SMS did not send.",
        };
        return;
      }

      await this.recordSmsOutcome(entry.id, "SENT", null);

      results[index] = { id, sent: true, mode, expiresAt: expiresAt.toISOString() };
      if (entry.status === "PENDING") await this.markNotified(entry.id);
    });

    const sentIds = results.filter((outcome) => outcome.sent).map((outcome) => outcome.id);
    const invitedAt = new Date().toISOString();

    if (sentIds.length > 0) {
      await this.auditService.recordDetached({
        actor: { sub: context.actor.sub, email: context.actor.email },
        action: "UPDATE",
        entityType: "waitlist_entry",
        after: { action: "invited", ids: sentIds, invitedAt },
        note: `Invited ${sentIds.length} waitlist entr${sentIds.length === 1 ? "y" : "ies"}.`,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });
    }

    return { results, invitedAt };
  }

  /**
   * Same "first told" semantics as `AdminWaitlistService.notify` — only a
   * PENDING row moves, and re-inviting an already-NOTIFIED entry (a customer
   * lost the SMS, or their link expired) does not restamp `notifiedAt`.
   */
  /**
   * Run `task` over every item, at most `limit` at a time, in order started.
   *
   * A fixed pool of workers pulling from a shared cursor rather than chunked
   * `Promise.all` batches: a chunk runs only as fast as its slowest member,
   * so one send sitting on the gateway timeout would idle the other four for
   * the whole of it. Here a finished worker takes the next id immediately.
   *
   * `task` is expected to handle its own failures — every rejection here
   * would abort the pool and lose the outcomes of everything still running,
   * which is precisely the failure mode this whole change exists to remove.
   */
  private async eachWithConcurrency<T>(
    items: readonly T[],
    limit: number,
    task: (item: T, index: number) => Promise<void>,
  ): Promise<void> {
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (cursor < items.length) {
        const index = cursor++;
        await task(items[index]!, index);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(limit, items.length) }, () => worker()),
    );
  }

  /**
   * Persist what happened to one invite text.
   *
   * The single most important line of this service: it is what makes a
   * partial batch recoverable. Everything else about a send — which token,
   * which URL, which language — is reconstructable, but "did it arrive"
   * exists nowhere else once the response is gone.
   *
   * Its own failure is swallowed to a log rather than thrown. A database
   * hiccup while recording an outcome must not turn a text that genuinely
   * went out into a batch-wide error; the worst case is one row whose
   * delivery column is stale, which staff read as "unknown" and can retry.
   */
  private async recordSmsOutcome(
    id: string,
    status: "SENT" | "FAILED",
    error: string | null,
  ): Promise<void> {
    try {
      await this.dbService.db
        .update(waitlistEntries)
        .set({
          inviteSmsStatus: status,
          // Truncated: the column is read in a table cell, and a gateway that
          // returns an HTML error page would otherwise store the whole thing.
          inviteSmsError: error ? error.slice(0, 500) : null,
          inviteSmsAt: new Date(),
        })
        .where(eq(waitlistEntries.id, id));
    } catch (cause) {
      this.logger.error(`Could not record invite SMS outcome for ${id}: ${String(cause)}`);
    }
  }

  private async markNotified(id: string): Promise<void> {
    const notifiedAt = new Date();

    await this.dbService.db
      .update(waitlistEntries)
      .set({ status: "NOTIFIED", notifiedAt, updatedAt: notifiedAt })
      .where(eq(waitlistEntries.id, id));
  }
}
