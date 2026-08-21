import { Injectable } from "@nestjs/common";
import type {
  AdminRegion,
  AdminRegionCreate,
  AdminRegionUpdate,
  AdminShippingTerms,
  ShippingTermsUpdate,
  UnitsSoldReport,
} from "@sakura/contracts";
import { DbService } from "../../db/db.service";
import { UnitsSoldReconciler } from "../../inventory";
import { RegionsService, ShippingTermsService } from "../../shipping";
import { AuditService } from "../../audit";
import type { AdminContext } from "../orders";

/**
 * Shop policy, and the maintenance jobs.
 *
 * Same rule as AdminOrdersService: this writes nothing itself. The postage
 * numbers go through ShippingTermsService, the regions through RegionsService,
 * the rollup correction through UnitsSoldReconciler. What this adds is the
 * actor and the audit entry.
 *
 * Every write here is audited *inside* the transaction that performs it —
 * unlike the order transition, which degrades to a detached entry because
 * `order_status_history` is a second, append-only record of the same fact.
 * Nothing in this file has one of those. The audit log is the only place a
 * change to the shop's delivery pricing is recorded at all, so if it cannot be
 * written the change does not happen.
 */
@Injectable()
export class AdminSettingsService {
  constructor(
    private readonly dbService: DbService,
    private readonly shippingTermsService: ShippingTermsService,
    private readonly regionsService: RegionsService,
    private readonly reconciler: UnitsSoldReconciler,
    private readonly auditService: AuditService,
  ) {}

  async shippingTerms(): Promise<AdminShippingTerms> {
    return this.shippingTermsService.describe();
  }

  /**
   * Change the postage rules.
   *
   * The `before` in the audit entry is the *effective* terms, not the stored
   * row — so the first edit records what the shop was actually charging (the
   * environment's values) rather than a pair of nulls. A diff that reads
   * `null → 8000` tells you nothing about what changed for customers.
   */
  async updateShippingTerms(
    changes: ShippingTermsUpdate,
    context: AdminContext,
  ): Promise<AdminShippingTerms> {
    const before = await this.shippingTermsService.describe();

    await this.dbService.db.transaction(async (tx) => {
      await this.shippingTermsService.update(
        changes,
        { id: context.actor.sub, email: context.actor.email },
        tx,
      );

      await this.auditService.record(
        {
          ...auditActor(context),
          action: "UPDATE",
          entityType: "shop_settings",
          entityId: "shipping",
          before: {
            flatRateCents: before.flatRateCents,
            freeDeliveryThresholdCents: before.freeDeliveryThresholdCents,
            originDivision: before.originDivision,
            source: before.source,
          },
          after: { ...changes },
        },
        tx,
      );
    });

    return this.shippingTermsService.describe();
  }

  /** Every region, active or not — the operator view. */
  async regions(): Promise<AdminRegion[]> {
    return this.regionsService.listAll();
  }

  async createRegion(input: AdminRegionCreate, context: AdminContext): Promise<AdminRegion> {
    return this.dbService.db.transaction(async (tx) => {
      const created = await this.regionsService.create(input, tx);

      await this.auditService.record(
        {
          ...auditActor(context),
          action: "CREATE",
          entityType: "delivery_regions",
          entityId: created.slug,
          after: { ...created },
        },
        tx,
      );

      return created;
    });
  }

  /**
   * Edit a region.
   *
   * Read before write so the audit entry carries a real `before`. That read is
   * outside the transaction and could in principle be stale by a hair, which
   * is acceptable precisely here: the consequence is an audit diff whose
   * "before" is one edit behind, and the alternative — locking the row to
   * narrate a change to a delivery rate — costs more than the imprecision.
   * Where a stale read would change *what is written*, this codebase locks
   * (see the guest cancel's `for update`).
   */
  async updateRegion(
    slug: string,
    changes: AdminRegionUpdate,
    context: AdminContext,
  ): Promise<AdminRegion> {
    const before = await this.regionsService.find(slug);

    return this.dbService.db.transaction(async (tx) => {
      const updated = await this.regionsService.update(slug, changes, tx);

      await this.auditService.record(
        {
          ...auditActor(context),
          action: "UPDATE",
          entityType: "delivery_regions",
          entityId: slug,
          before: { ...before },
          after: { ...updated },
        },
        tx,
      );

      return updated;
    });
  }

  /**
   * Stop offering a region. Deactivation, never deletion.
   *
   * Orders snapshot the region slug onto `shipping_address`, so a deleted row
   * would leave historical orders naming a region nothing resolves — and the
   * table's own comment already says as much. This is that comment enforced by
   * there being no delete method to call.
   */
  async deactivateRegion(slug: string, context: AdminContext): Promise<AdminRegion> {
    return this.updateRegion(slug, { isActive: false }, context);
  }

  /** Inspect the `units_sold` cache without touching it. */
  async unitsSoldDrift(): Promise<UnitsSoldReport> {
    return this.reconciler.report();
  }

  /**
   * Correct the `units_sold` cache.
   *
   * Audited even though it changes no policy, because it is a bulk write over
   * the catalog and "the bestseller list changed overnight" needs an answer.
   * The entry records how many titles moved rather than each one — the report
   * is returned to the caller and a fifty-element diff in an audit row is not
   * a thing anyone reads.
   */
  async reconcileUnitsSold(context: AdminContext): Promise<UnitsSoldReport> {
    const report = await this.reconciler.reconcile();

    await this.auditService.recordDetached({
      ...auditActor(context),
      action: "ADJUST",
      entityType: "books",
      after: {
        booksChecked: report.booksChecked,
        titlesCorrected: report.drifted.length,
      },
      note: "units_sold reconciliation",
    });

    return report;
  }
}

function auditActor(context: AdminContext) {
  return {
    actor: { sub: context.actor.sub, email: context.actor.email },
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  };
}
