import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AdminWaitlistInviteOutcome, AdminWaitlistInviteRequest, AdminWaitlistInviteResult } from "@sakura/contracts";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Env } from "../../config/env.schema";
import { AuditService } from "../../audit";
import { DbService } from "../../db/db.service";
import { waitlistEntries } from "../../db/schema";
import { SmsService } from "../../sms";
import {
  WaitlistAllocationService,
  WaitlistInviteService,
  WaitlistInviteSettingsService,
} from "../../waitlist";
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
    private readonly waitlistAllocationService: WaitlistAllocationService,
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
  private async refuseBeyondAllocation(
    ids: string[],
    entries: { id: string; status: string; bookId: string | null; quantity: number }[],
  ): Promise<{ refusals: Map<string, string>; allocationByBook: Map<string, string> }> {
    const refusals = new Map<string, string>();
    const allocationByBook = new Map<string, string>();

    const eligible = ids
      .map((id) => entries.find((row) => row.id === id))
      .filter(
        (entry): entry is (typeof entries)[number] =>
          !!entry && entry.status !== "CANCELLED" && entry.status !== "CONVERTED" && !!entry.bookId,
      );

    const bookIds = [...new Set(eligible.map((entry) => entry.bookId!))];
    if (bookIds.length === 0) return { refusals, allocationByBook };

    /* Capacity is now the *release's* budget, not the print run — the whole
       point of `docs/waitlist-queue-system.md` step 2. `spendableByBook`
       returns the smaller of what this release has left and what physically
       exists unheld, so a 50-of-60 release stops at 50 and the shop's ten
       counter copies survive the morning.

       Entries in this batch are excluded from both halves of that sum, so
       re-inviting a lapsed entry costs its copies once rather than twice. */
    const budgets = await this.waitlistAllocationService.spendableByBook(bookIds, {
      excludeEntryIds: eligible.map((entry) => entry.id),
    });

    const budget = new Map<string, number>();
    for (const [bookId, row] of budgets) {
      budget.set(bookId, row.spendable);
      allocationByBook.set(bookId, row.allocationId);
    }

    /* Which of these entries is *already* holding a live invite right now.
       Needed because the exclusion above is a loan against an assumption —
       that every entry in the batch is about to have its token rewritten. A
       refused entry has no token rewritten: its existing invite stands, and
       the copies it holds were nonetheless taken out of the budget. Without
       charging them back, every refusal on a book quietly raises that book's
       budget by the refused quantity and hands the difference to the entries
       behind it — the exact over-issue the whole method exists to prevent,
       reached through the branch that is supposed to prevent it. */
    const stillHolding = await this.liveInviteHolders(eligible.map((entry) => entry.id));

    for (const entry of eligible) {
      const bookId = entry.bookId!;

      /* No open release is a refusal, never a fallback to physical stock.
         Defaulting to the print run here is precisely the behaviour releases
         exist to end, and it would come back silently — the batch would send,
         the copies would go, and nothing would say which budget paid. */
      if (!budgets.has(bookId)) {
        refusals.set(
          entry.id,
          "No open stock release for this book. Open one to decide how many copies the waitlist gets.",
        );
        continue;
      }

      const remaining = budget.get(bookId) ?? 0;

      if (entry.quantity > remaining) {
        refusals.set(
          entry.id,
          remaining > 0
            ? `Only ${remaining} ${remaining === 1 ? "copy" : "copies"} left in this release — this entry asks for ${entry.quantity}.`
            : "This release is fully spoken for. Wait for an invite to lapse, or allocate more copies.",
        );

        /* A reservation is charged whether or not this batch renewed it. The
           result can go negative, and that is the honest reading: the book is
           over-issued — more copies promised than printed, which an admin
           lowering the stock count can create at any time — and every entry
           after this one is refused, which is the correct behaviour for it. */
        if (stillHolding.has(entry.id)) budget.set(bookId, remaining - entry.quantity);
        continue;
      }

      budget.set(bookId, remaining - entry.quantity);
    }

    return { refusals, allocationByBook };
  }

  /**
   * Of these entries, the ones whose invite could still be spent this second.
   *
   * The same three conditions `reservations.ts` counts a copy as spoken for
   * under, and matched here for that reason: this answers "is this entry's
   * reservation inside the number `spare` was computed from", so it has to be
   * the same question, asked the same way. `now()` rather than a JS
   * timestamp, so an invite lapsing mid-request is read by the database's
   * clock like everywhere else.
   */
  private async liveInviteHolders(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();

    const rows = await this.dbService.db
      .select({ id: waitlistEntries.id })
      .from(waitlistEntries)
      .where(
        and(
          inArray(waitlistEntries.id, ids),
          isNotNull(waitlistEntries.inviteToken),
          isNull(waitlistEntries.inviteUsedAt),
          sql`${waitlistEntries.inviteExpiresAt} > now()`,
        ),
      );

    return new Set(rows.map((row) => row.id));
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

    const { refusals: overCapacity, allocationByBook } = await this.refuseBeyondAllocation(
      request.ids,
      entries,
    );

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
      /* Null for an OPEN invite, which names no book, reserves nothing and so
         has no release to charge. Every LOCKED one has an id here: the
         capacity pass above refuses any book without an open release before
         this line is reached. */
      const allocationId = entry.bookId ? (allocationByBook.get(entry.bookId) ?? null) : null;
      const { token, expiresAt } = await this.waitlistInviteService.issue(
        entry.id,
        ttlHours,
        mode,
        allocationId,
        /* Null for a hand-picked send — the per-row button, a re-invite off
           the Expired tab. Those charge a release but belong to no round, and
           saying so is more honest than inventing a wave of one. */
        request.waveId ?? null,
      );
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
