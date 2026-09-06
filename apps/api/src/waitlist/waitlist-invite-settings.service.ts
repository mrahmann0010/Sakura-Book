import { Injectable } from "@nestjs/common";
import type { AdminWaitlistInviteSettings, WaitlistInviteLanguage } from "@sakura/contracts";
import { eq } from "drizzle-orm";
import { DbService } from "../db/db.service";
import type { Executor, Transaction } from "../db/db.types";
import { shopSettings } from "../db/schema";

/** The singleton row's fixed key — see the table's check constraint. */
const SETTINGS_ID = "singleton";

/** WaitlistInviteService.issue() falls back to this when staff have never
 *  opened the setting — long enough to be seen, short enough to recycle a
 *  slot if nobody acts on it. */
const DEFAULT_TTL_HOURS = 48;

/** Defer to the entry's own submitted locale until staff pin a language. */
const DEFAULT_LANGUAGE: WaitlistInviteLanguage = "customer";

/**
 * How many hours a waitlist invite link stays redeemable.
 *
 * Shaped exactly like SmsSettingsService: read the singleton, upsert on
 * write, no environment fallback — this is shop policy staff set once, not
 * infrastructure config for a deploy to own.
 */
@Injectable()
export class WaitlistInviteSettingsService {
  constructor(private readonly dbService: DbService) {}

  /** The value `AdminWaitlistInviteService.invite` should pass to `issue()`. */
  async ttlHours(executor: Executor = this.dbService.db): Promise<number> {
    const row = await this.row(executor);
    return row?.waitlistInviteTtlHours ?? DEFAULT_TTL_HOURS;
  }

  /** The language `AdminWaitlistInviteService.invite` should send each invite in. */
  async language(executor: Executor = this.dbService.db): Promise<WaitlistInviteLanguage> {
    const row = await this.row(executor);
    return (row?.waitlistInviteLanguage as WaitlistInviteLanguage | null) ?? DEFAULT_LANGUAGE;
  }

  /** The same values, plus who last set them and when. */
  async describe(executor: Executor = this.dbService.db): Promise<AdminWaitlistInviteSettings> {
    const row = await this.row(executor);

    return {
      ttlHours: row?.waitlistInviteTtlHours ?? null,
      language: (row?.waitlistInviteLanguage as WaitlistInviteLanguage | null) ?? null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedByEmail: row?.updatedByEmail ?? null,
    };
  }

  /**
   * Set the TTL and invite language. An upsert, for the same concurrent-first-save
   * reason as SmsSettingsService.update — two admins saving at once both find no
   * row, and `onConflictDoUpdate` makes the second a plain update rather than a
   * primary-key error.
   */
  async update(
    ttlHours: number,
    language: WaitlistInviteLanguage,
    actor: { id: string; email: string },
    tx: Transaction,
  ): Promise<void> {
    const values = {
      waitlistInviteTtlHours: ttlHours,
      waitlistInviteLanguage: language,
      updatedById: actor.id,
      updatedByEmail: actor.email,
      updatedAt: new Date(),
    };

    await tx
      .insert(shopSettings)
      .values({ id: SETTINGS_ID, ...values })
      .onConflictDoUpdate({ target: shopSettings.id, set: values });
  }

  private async row(executor: Executor) {
    return executor.query.shopSettings.findFirst({ where: eq(shopSettings.id, SETTINGS_ID) });
  }
}
