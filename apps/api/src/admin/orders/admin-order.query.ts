import { and, asc, desc, eq, gte, ilike, inArray, lte, or, type SQL } from "drizzle-orm";
import type { AdminOrderQuery } from "@sakura/contracts";
import { orders } from "../../db/schema";

/**
 * `where` and `order by` for the order queue, built from validated params.
 *
 * Split from the service for the same reason catalog/book.query.ts is: these
 * are the two pieces worth reading and unit-testing on their own, and every
 * function here returns a fragment rather than running anything.
 *
 * Note the difference from the catalog's equivalent: there is no `isActive`
 * equivalent here, no row this query is forbidden from returning. The catalog
 * browse hides delisted books from customers; the order queue is staff-only
 * and hiding an order from staff would mean an order nobody can act on.
 */

/**
 * Free text across the four identifiers a customer might quote.
 *
 * The order number is matched case-insensitively and anchored to the *start*,
 * because it is read off a printed confirmation and typed in whole — a
 * substring match on an eight-character space would turn a search for "40718"
 * into a scan. The other three are substring matches, since a caller might
 * offer half a name or the last digits of a phone number.
 *
 * Escaped before interpolation. An unescaped `%` typed into a staff search box
 * would match every order in the shop, which looks like a broken filter rather
 * than like the wildcard it is — the same trap catalog search documents.
 */
function textMatch(term: string): SQL {
  const escaped = term.replace(/([\\%_])/g, "\\$1");

  return or(
    ilike(orders.orderNumber, `${escaped}%`),
    ilike(orders.customerName, `%${escaped}%`),
    ilike(orders.customerEmail, `%${escaped}%`),
    ilike(orders.customerPhone, `%${escaped}%`),
  )!;
}

export function adminOrderFilters(query: AdminOrderQuery): SQL | undefined {
  const conditions: SQL[] = [];

  if (query.status?.length) conditions.push(inArray(orders.status, query.status));
  if (query.paymentMethod) conditions.push(eq(orders.paymentMethod, query.paymentMethod));
  if (query.q) conditions.push(textMatch(query.q));

  if (query.placedFrom) {
    conditions.push(gte(orders.createdAt, new Date(`${query.placedFrom}T00:00:00.000Z`)));
  }

  /**
   * The upper bound is the *end* of the named day, not its midnight.
   *
   * `placedTo=2026-08-20` means "up to and including the 20th", which is what
   * a date picker labelled "to" means to the person using it. Comparing
   * against midnight would silently exclude every order placed on the last day
   * of the range — the most recent ones, and the ones the search was for.
   */
  if (query.placedTo) {
    conditions.push(lte(orders.createdAt, new Date(`${query.placedTo}T23:59:59.999Z`)));
  }

  return conditions.length ? and(...conditions) : undefined;
}

/**
 * Sort, with a stable tiebreak on every branch.
 *
 * Same reasoning as the catalog's: offset pagination over a non-deterministic
 * order drops and duplicates rows between pages. It bites harder here — two
 * orders placed in the same second is routine during a promotion, and a
 * fulfilment queue that silently omits one is an order that never ships.
 */
export function adminOrderOrder(sort: AdminOrderQuery["sort"]): SQL[] {
  switch (sort) {
    case "oldest":
      return [asc(orders.createdAt), asc(orders.id)];
    case "total-desc":
      return [desc(orders.totalCents), asc(orders.id)];
    case "recent":
    default:
      return [desc(orders.createdAt), asc(orders.id)];
  }
}
