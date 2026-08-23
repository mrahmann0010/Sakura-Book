import { Inject, Injectable } from "@nestjs/common";
import type { AdminPaymentNumbers, PaymentNumbers } from "@sakura/contracts";
import { eq } from "drizzle-orm";
import {
  PAYMENT_NUMBERS_CONFIG,
  type PaymentNumbersConfig,
} from "../config/payment-numbers.config";
import { DbService } from "../db/db.service";
import type { Executor, Transaction } from "../db/db.types";
import { shopSettings } from "../db/schema";

/** The singleton row's fixed key — see the table's check constraint. */
const SETTINGS_ID = "singleton";

/**
 * The bKash/Rocket/Nagad numbers checkout shows for manual transfer.
 *
 * Same shape as ShippingTermsService, for the same reason: a shop that has
 * never opened Payment Settings shows the environment's numbers exactly as it
 * did when they lived in the browser bundle, and saving one wallet's number
 * moves only that column to the database — the other two stay on the
 * environment until they are saved too.
 */
@Injectable()
export class PaymentNumbersService {
  constructor(
    private readonly dbService: DbService,
    @Inject(PAYMENT_NUMBERS_CONFIG) private readonly fallback: PaymentNumbersConfig,
  ) {}

  async current(executor: Executor = this.dbService.db): Promise<PaymentNumbers> {
    const row = await this.row(executor);

    return Object.freeze({
      bkashNumber: row?.bkashNumber ?? this.fallback.bkashNumber,
      rocketNumber: row?.rocketNumber ?? this.fallback.rocketNumber,
      nagadNumber: row?.nagadNumber ?? this.fallback.nagadNumber,
    });
  }

  /** The same numbers, plus where they came from and who last touched them. */
  async describe(executor: Executor = this.dbService.db): Promise<AdminPaymentNumbers> {
    const row = await this.row(executor);
    const numbers = await this.current(executor);

    return {
      ...numbers,
      source:
        row && (row.bkashNumber !== null || row.rocketNumber !== null || row.nagadNumber !== null)
          ? "database"
          : "environment",
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedByEmail: row?.updatedByEmail ?? null,
    };
  }

  /**
   * Save one or more numbers. An upsert, for the same concurrent-first-save
   * reason as ShippingTermsService.update — two admins saving at once both
   * find no row, and `onConflictDoUpdate` makes the second a plain update
   * rather than a primary-key error.
   */
  async update(
    changes: { bkashNumber?: string; rocketNumber?: string; nagadNumber?: string },
    actor: { id: string; email: string },
    tx: Transaction,
  ): Promise<void> {
    const values = {
      ...(changes.bkashNumber !== undefined ? { bkashNumber: changes.bkashNumber } : {}),
      ...(changes.rocketNumber !== undefined ? { rocketNumber: changes.rocketNumber } : {}),
      ...(changes.nagadNumber !== undefined ? { nagadNumber: changes.nagadNumber } : {}),
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
