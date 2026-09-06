import { Injectable } from "@nestjs/common";
import type { AdminSmsSettings } from "@sakura/contracts";
import { eq } from "drizzle-orm";
import { DbService } from "../db/db.service";
import type { Executor, Transaction } from "../db/db.types";
import { shopSettings } from "../db/schema";

/** The singleton row's fixed key — see the table's check constraint. */
const SETTINGS_ID = "singleton";

/**
 * Which SIM slot the gateway phone sends from.
 *
 * Shaped like RestockScheduleService: read the singleton, upsert on write, no
 * environment fallback — this is a fact about the shop's messaging setup that
 * staff set once and it holds, not infrastructure config for a deploy to own.
 * Null means "let the gateway app's own sim_selection_mode decide", the same
 * real, non-missing meaning null carries on the rest of this table.
 */
@Injectable()
export class SmsSettingsService {
  constructor(private readonly dbService: DbService) {}

  /** The number `SmsService.send` should use when a caller doesn't override it. */
  async simNumber(executor: Executor = this.dbService.db): Promise<number | null> {
    const row = await this.row(executor);
    return row?.smsSimNumber ?? null;
  }

  /** The same value, plus who last set it and when. */
  async describe(executor: Executor = this.dbService.db): Promise<AdminSmsSettings> {
    const row = await this.row(executor);

    return {
      simNumber: (row?.smsSimNumber as 1 | 2 | 3 | null) ?? null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedByEmail: row?.updatedByEmail ?? null,
    };
  }

  /**
   * Set or clear the SIM. An upsert, for the same concurrent-first-save
   * reason as RestockScheduleService.update — two admins saving at once both
   * find no row, and `onConflictDoUpdate` makes the second a plain update
   * rather than a primary-key error.
   */
  async update(
    simNumber: 1 | 2 | 3 | null,
    actor: { id: string; email: string },
    tx: Transaction,
  ): Promise<void> {
    const values = {
      smsSimNumber: simNumber,
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
