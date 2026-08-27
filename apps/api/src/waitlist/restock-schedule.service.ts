import { Injectable } from "@nestjs/common";
import type { AdminRestockSchedule, RestockSchedule } from "@sakura/contracts";
import { eq } from "drizzle-orm";
import { DbService } from "../db/db.service";
import type { Executor, Transaction } from "../db/db.types";
import { shopSettings } from "../db/schema";

/** The singleton row's fixed key — see the table's check constraint. */
const SETTINGS_ID = "singleton";

/**
 * When ordering reopens, shop-wide.
 *
 * Shaped like PaymentNumbersService and ShippingTermsService — read the
 * singleton, upsert on write — with one deliberate difference: there is no
 * environment fallback. A reopening date is a promise the shop makes to
 * customers on a particular day, not infrastructure configuration, and a
 * deployment variable is the wrong place to keep something staff need to move
 * the moment a printer slips. Null means no date is announced, and that is a
 * real answer rather than a missing one.
 */
@Injectable()
export class RestockScheduleService {
  constructor(private readonly dbService: DbService) {}

  async current(executor: Executor = this.dbService.db): Promise<RestockSchedule> {
    const row = await this.row(executor);

    return Object.freeze({ reopenDate: row?.reopenDate ?? null });
  }

  /** The same date, plus who last set it and when. */
  async describe(executor: Executor = this.dbService.db): Promise<AdminRestockSchedule> {
    const row = await this.row(executor);

    return {
      reopenDate: row?.reopenDate ?? null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedByEmail: row?.updatedByEmail ?? null,
    };
  }

  /**
   * Set or clear the date. An upsert, for the same concurrent-first-save
   * reason as PaymentNumbersService.update — two admins saving at once both
   * find no row, and `onConflictDoUpdate` makes the second a plain update
   * rather than a primary-key error.
   *
   * `reopenDate` is written unconditionally, including when null: null here
   * means "take the announcement down", not "leave it alone". See
   * `restockScheduleUpdateSchema`.
   */
  async update(
    reopenDate: string | null,
    actor: { id: string; email: string },
    tx: Transaction,
  ): Promise<void> {
    const values = {
      reopenDate,
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
