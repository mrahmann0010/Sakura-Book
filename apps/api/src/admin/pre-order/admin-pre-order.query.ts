import type { AdminPreOrderQuery } from "@sakura/contracts";
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, type SQL } from "drizzle-orm";
import { preOrderOrders } from "../../db/schema";

/**
 * `where` and `order by` for the pre-order queue.
 *
 * Split from the service for the same reason admin-order.query.ts is: these
 * are the pieces worth reading and testing on their own, and every function
 * returns a fragment rather than running anything.
 */

/** Same four identifiers, same anchoring and escaping — see admin-order.query.ts. */
function textMatch(term: string): SQL {
  const escaped = term.replace(/([\\%_])/g, "\\$1");

  return or(
    ilike(preOrderOrders.orderNumber, `${escaped}%`),
    ilike(preOrderOrders.customerName, `%${escaped}%`),
    ilike(preOrderOrders.customerEmail, `%${escaped}%`),
    ilike(preOrderOrders.customerPhone, `%${escaped}%`),
  )!;
}

export function adminPreOrderFilters(query: AdminPreOrderQuery): SQL | undefined {
  const conditions: SQL[] = [];

  /**
   * The two tracks AND together rather than OR, which is what makes the
   * useful query expressible: `paymentStatus=ACCEPTED&fulfillmentStatus=
   * NOT_STARTED` is "paid, waiting on the print run" — the list you work from
   * the day the copies arrive.
   */
  if (query.paymentStatus?.length) {
    conditions.push(inArray(preOrderOrders.paymentStatus, query.paymentStatus));
  }
  if (query.fulfillmentStatus?.length) {
    conditions.push(inArray(preOrderOrders.fulfillmentStatus, query.fulfillmentStatus));
  }

  if (query.paymentMethod) conditions.push(eq(preOrderOrders.paymentMethod, query.paymentMethod));
  if (query.q) conditions.push(textMatch(query.q));

  if (query.placedFrom) {
    conditions.push(gte(preOrderOrders.createdAt, new Date(`${query.placedFrom}T00:00:00.000Z`)));
  }

  /** Inclusive of the named day — see the same note in admin-order.query.ts. */
  if (query.placedTo) {
    conditions.push(lte(preOrderOrders.createdAt, new Date(`${query.placedTo}T23:59:59.999Z`)));
  }

  return conditions.length ? and(...conditions) : undefined;
}

/** Sort, with a stable tiebreak on every branch — offset pagination needs it. */
export function adminPreOrderOrder(sort: AdminPreOrderQuery["sort"]): SQL[] {
  switch (sort) {
    case "oldest":
      return [asc(preOrderOrders.createdAt), asc(preOrderOrders.id)];
    case "total-desc":
      return [desc(preOrderOrders.totalCents), desc(preOrderOrders.id)];
    default:
      return [desc(preOrderOrders.createdAt), desc(preOrderOrders.id)];
  }
}
