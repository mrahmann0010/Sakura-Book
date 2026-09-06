import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AdminWaitlistInviteOutcome, AdminWaitlistInviteRequest, AdminWaitlistInviteResult } from "@sakura/contracts";
import { eq, inArray } from "drizzle-orm";
import type { Env } from "../../config/env.schema";
import { AuditService } from "../../audit";
import { DbService } from "../../db/db.service";
import { waitlistEntries } from "../../db/schema";
import { SmsService } from "../../sms";
import { WaitlistInviteService, WaitlistInviteSettingsService } from "../../waitlist";
import type { AdminContext } from "../orders";

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

    const results: AdminWaitlistInviteOutcome[] = [];
    const sentIds: string[] = [];

    for (const id of request.ids) {
      const entry = entries.find((row) => row.id === id);

      // Same exclusion `notify()` applies: someone who cancelled or already
      // converted is not a candidate to invite, regardless of what staff
      // selected on screen.
      if (!entry || entry.status === "CANCELLED" || entry.status === "CONVERTED") {
        results.push({ id, sent: false, mode: null, expiresAt: null, error: "Not eligible." });
        continue;
      }

      const mode = entry.bookId ? "LOCKED" : "OPEN";
      const { token, expiresAt } = await this.waitlistInviteService.issue(entry.id, ttlHours, mode);
      const url = `${webOrigin}/${entry.locale}/waitlist/invite/${token}`;

      // "customer" defers to whichever locale the entry was submitted under;
      // an explicit "en"/"bn" pins the text regardless. The template only
      // knows English and Bangla, so a third-language signup (e.g. "ja")
      // still reads in English rather than sending nothing.
      const smsLanguage =
        inviteLanguage === "customer" ? (entry.locale === "bn" ? "bn" : "en") : inviteLanguage;

      try {
        await this.smsService.sendInviteLink(entry.customerPhone, url, smsLanguage, ttlHours);
      } catch (error) {
        this.logger.warn(`Invite SMS failed for waitlist entry ${entry.id}: ${String(error)}`);
        results.push({
          id,
          sent: false,
          mode,
          expiresAt: expiresAt.toISOString(),
          error: "SMS did not send.",
        });
        continue;
      }

      results.push({ id, sent: true, mode, expiresAt: expiresAt.toISOString() });
      sentIds.push(entry.id);
      if (entry.status === "PENDING") await this.markNotified(entry.id);
    }

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
  private async markNotified(id: string): Promise<void> {
    const notifiedAt = new Date();

    await this.dbService.db
      .update(waitlistEntries)
      .set({ status: "NOTIFIED", notifiedAt, updatedAt: notifiedAt })
      .where(eq(waitlistEntries.id, id));
  }
}
