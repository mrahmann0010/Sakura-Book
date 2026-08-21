import { Injectable } from "@nestjs/common";
import type { ShippingRegion } from "@sakura/contracts";
import type { AdminRegion, AdminRegionCreate, AdminRegionUpdate } from "@sakura/contracts";
import { asc, eq } from "drizzle-orm";
import { DbService } from "../db/db.service";
import type { Executor, Transaction } from "../db/db.types";
import { deliveryRegions } from "../db/schema";
import { UnknownRegionError } from "./shipping.errors";

/**
 * Where the shop delivers, and what it charges to get there.
 *
 * The list is a table rather than a constant in @sakura/contracts on purpose:
 * baking today's regions into the shared package would make adding one a
 * package release consumed by two apps. `region` crosses the wire as a slug
 * and is checked here.
 */
@Injectable()
export class RegionsService {
  constructor(private readonly dbService: DbService) {}

  /** Deliverable regions, in display order. Inactive rows are not offered. */
  async list(executor: Executor = this.dbService.db): Promise<ShippingRegion[]> {
    return executor
      .select({
        slug: deliveryRegions.slug,
        name: deliveryRegions.name,
        deliveryCentsOverride: deliveryRegions.deliveryCentsOverride,
      })
      .from(deliveryRegions)
      .where(eq(deliveryRegions.isActive, true))
      .orderBy(asc(deliveryRegions.sortOrder), asc(deliveryRegions.name));
  }

  /**
   * The postage override for a slug, or null for the flat national rate.
   *
   * Lenient by design, and this is the half of the pair that must be: it
   * serves `/cart/quote`, which is called before the customer has reached the
   * address step. An absent or unrecognised region there means "not chosen
   * yet", and erroring would make the cart page unable to show a total at all.
   * Falling back to the flat rate is also the safe direction — if a region
   * charges *more*, quoting the flat rate and then correcting at checkout is
   * recoverable, whereas quoting a region's cheap rate for an unknown slug is
   * undercharging.
   */
  async deliveryRateFor(
    slug: string | undefined,
    executor: Executor = this.dbService.db,
  ): Promise<number | null> {
    if (!slug) return null;

    const region = await executor.query.deliveryRegions.findFirst({
      where: (row, { and, eq: equals }) => and(equals(row.slug, slug), equals(row.isActive, true)),
      columns: { deliveryCentsOverride: true },
    });

    return region?.deliveryCentsOverride ?? null;
  }

  /**
   * Resolve a slug the customer actually chose, or refuse the order.
   *
   * The strict counterpart to `deliveryRateFor`, for checkout. Here the region
   * is a submitted form field, not a maybe: accepting an unknown slug would
   * write an undeliverable address onto a real order and charge flat-rate
   * postage for somewhere we do not go. A BusinessRuleError rather than a
   * validation failure because the value is structurally fine — it is the
   * lookup that says no, which the schema could not have known.
   */
  async require(slug: string, executor: Executor = this.dbService.db): Promise<ShippingRegion> {
    const region = await executor.query.deliveryRegions.findFirst({
      where: (row, { and, eq: equals }) => and(equals(row.slug, slug), equals(row.isActive, true)),
      columns: { slug: true, name: true, deliveryCentsOverride: true },
    });

    if (!region) throw new UnknownRegionError(slug);

    return region;
  }

  /**
   * Every region, including the deactivated ones — the operator view.
   *
   * `list()` above is the customer's and filters to active rows. Staff need
   * the opposite: a region that has been switched off is exactly the row they
   * came here to find, and hiding it would make deactivation look like
   * deletion with no way back.
   */
  async listAll(executor: Executor = this.dbService.db): Promise<AdminRegion[]> {
    return executor
      .select({
        slug: deliveryRegions.slug,
        name: deliveryRegions.name,
        deliveryCentsOverride: deliveryRegions.deliveryCentsOverride,
        sortOrder: deliveryRegions.sortOrder,
        isActive: deliveryRegions.isActive,
      })
      .from(deliveryRegions)
      .orderBy(asc(deliveryRegions.sortOrder), asc(deliveryRegions.name));
  }

  /**
   * Add a region.
   *
   * A duplicate slug surfaces through the unique index as the mapper's
   * ALREADY_EXISTS rather than being pre-checked here, for the usual reason: a
   * read-then-insert loses to a concurrent create, and the constraint is the
   * only thing that actually serialises them.
   */
  async create(input: AdminRegionCreate, tx: Transaction): Promise<AdminRegion> {
    const [row] = await tx
      .insert(deliveryRegions)
      .values({
        slug: input.slug,
        name: input.name,
        deliveryCentsOverride: input.deliveryCentsOverride,
        sortOrder: input.sortOrder,
      })
      .returning();

    return toAdminRegion(row);
  }

  /**
   * Change a region's name, rate, order, or active flag.
   *
   * The slug is not updatable and is not in `AdminRegionUpdate` — orders
   * snapshot the region string onto `shipping_address`, so a renamed slug
   * orphans every historical order that names it. See the contract's comment.
   *
   * Only the keys actually present are written. A `PATCH` that sent every
   * field would let two admins editing different fields of the same region
   * silently overwrite each other with the values their form loaded.
   */
  async update(
    slug: string,
    changes: AdminRegionUpdate,
    tx: Transaction,
  ): Promise<AdminRegion> {
    const [row] = await tx
      .update(deliveryRegions)
      .set({
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.deliveryCentsOverride !== undefined
          ? { deliveryCentsOverride: changes.deliveryCentsOverride }
          : {}),
        ...(changes.sortOrder !== undefined ? { sortOrder: changes.sortOrder } : {}),
        ...(changes.isActive !== undefined ? { isActive: changes.isActive } : {}),
      })
      .where(eq(deliveryRegions.slug, slug))
      .returning();

    if (!row) throw new UnknownRegionError(slug);

    return toAdminRegion(row);
  }

  /** The row as it stands, for an audit entry's `before`. */
  async find(slug: string, executor: Executor = this.dbService.db): Promise<AdminRegion> {
    const row = await executor.query.deliveryRegions.findFirst({
      where: eq(deliveryRegions.slug, slug),
    });

    if (!row) throw new UnknownRegionError(slug);

    return toAdminRegion(row);
  }
}

function toAdminRegion(row: typeof deliveryRegions.$inferSelect): AdminRegion {
  return {
    slug: row.slug,
    name: row.name,
    deliveryCentsOverride: row.deliveryCentsOverride,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
  };
}
