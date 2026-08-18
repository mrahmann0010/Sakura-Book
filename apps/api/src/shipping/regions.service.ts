import { Injectable } from "@nestjs/common";
import type { ShippingRegion } from "@sakura/contracts";
import { asc, eq } from "drizzle-orm";
import { DbService } from "../db/db.service";
import type { Executor } from "../db/db.types";
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
}
