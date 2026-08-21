import { Inject, Injectable } from "@nestjs/common";
import type { AdminShippingTerms } from "@sakura/contracts";
import { eq } from "drizzle-orm";
import { SHIPPING_CONFIG, type ShippingConfig } from "../config/shipping.config";
import { DbService } from "../db/db.service";
import type { Executor, Transaction } from "../db/db.types";
import { shopSettings } from "../db/schema";

/** The singleton row's fixed key — see the table's check constraint. */
const SETTINGS_ID = "singleton";

/**
 * The postage numbers every quote is priced against.
 *
 * ## Read from the database, per quote, uncached
 *
 * This is one indexed single-row read on the primary key, and `/cart/quote`
 * already runs several queries. Caching it in memory would buy a fraction of a
 * millisecond and cost the thing that matters: with more than one API
 * instance, an in-process cache means the shop's own staff change the
 * free-delivery threshold and watch half their traffic keep quoting the old
 * one, for as long as the TTL says. The number that decides what a customer is
 * charged is the wrong place to accept eventual consistency, and §3.15's rule
 * — HTTP caching first, application caches only when measured — points the
 * same way.
 *
 * ## Environment as the fallback, not as the setting
 *
 * A shop that has never opened the settings page prices from
 * `DELIVERY_FLAT_CENTS` and `FREE_DELIVERY_THRESHOLD_CENTS`, exactly as it did
 * before this table existed. Saving even one field moves that field to the
 * database permanently; the other stays on the environment until it is saved
 * too. The `source` field on the response is what makes that legible, because
 * the numbers alone cannot distinguish "defaulted" from "saved as the default"
 * — and only one of those changes when someone edits the deployment config.
 */
@Injectable()
export class ShippingTermsService {
  constructor(
    private readonly dbService: DbService,
    @Inject(SHIPPING_CONFIG) private readonly fallback: ShippingConfig,
  ) {}

  /**
   * The terms in force right now.
   *
   * Takes an `Executor` so checkout resolves them inside its own transaction,
   * for the same reason it re-prices there: a quote taken against terms that
   * changed before the order committed is a total the customer was shown and
   * not the one they were charged.
   */
  async current(executor: Executor = this.dbService.db): Promise<ShippingConfig> {
    const row = await this.row(executor);

    return Object.freeze({
      // Not overridable — the schema stores bare `*_cents` with no currency
      // column, so this is a property of the database, not a setting.
      currency: this.fallback.currency,
      flatRateCents: row?.deliveryFlatCents ?? this.fallback.flatRateCents,
      freeDeliveryThresholdCents:
        row?.freeDeliveryThresholdCents ?? this.fallback.freeDeliveryThresholdCents,
      originDivision: row?.originDivision ?? this.fallback.originDivision,
    });
  }

  /** The same numbers, plus where each came from and who last touched them. */
  async describe(executor: Executor = this.dbService.db): Promise<AdminShippingTerms> {
    const row = await this.row(executor);
    const terms = await this.current(executor);

    return {
      ...terms,
      /**
       * "database" only when at least one field is actually stored. A row that
       * exists with both columns null is still an unconfigured shop — the row
       * may have been created by a write that was later cleared, and reporting
       * it as configured would tell an operator their environment variables
       * are inert when they are the very thing being used.
       */
      source:
        row &&
        (row.deliveryFlatCents !== null ||
          row.freeDeliveryThresholdCents !== null ||
          row.originDivision !== null)
          ? "database"
          : "environment",
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedByEmail: row?.updatedByEmail ?? null,
    };
  }

  /**
   * Save one or both numbers.
   *
   * An upsert rather than a read-then-insert-or-update: two admins saving at
   * once would both find no row and both insert, and the second would hit the
   * primary key. `onConflictDoUpdate` makes the database serialise them, and
   * the loser becomes an update — which is the correct outcome, not an error
   * to show someone who pressed Save.
   *
   * Only the keys present in `changes` are written. That is what lets an
   * operator move the threshold to the database while leaving the flat rate on
   * the environment, and it is why the columns are nullable.
   *
   * `Transaction`, because the audit entry recording who changed the shop's
   * pricing must commit with the change — a settings write with no attribution
   * is the one this codebase can least afford to lose.
   */
  async update(
    changes: {
      flatRateCents?: number;
      freeDeliveryThresholdCents?: number;
      originDivision?: string;
    },
    actor: { id: string; email: string },
    tx: Transaction,
  ): Promise<void> {
    const values = {
      ...(changes.flatRateCents !== undefined
        ? { deliveryFlatCents: changes.flatRateCents }
        : {}),
      ...(changes.freeDeliveryThresholdCents !== undefined
        ? { freeDeliveryThresholdCents: changes.freeDeliveryThresholdCents }
        : {}),
      ...(changes.originDivision !== undefined
        ? { originDivision: changes.originDivision }
        : {}),
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
