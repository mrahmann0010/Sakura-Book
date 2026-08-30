import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { districtsFor, type AdminOrderQuery } from "@sakura/contracts";
import { orders } from "../../db/schema";
import { ORDER_NUMBER_PREFIX } from "../../orders/order-number";

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
 * The order-number pattern a typed term should match, if it looks like one.
 *
 * Staff read the number off a phone screen or a printed slip and type the part
 * that varies — "40718". Requiring the `NB-` back is asking a person to retype
 * a constant several dozen times a day, and the digits alone match nothing
 * against a start-anchored `NB-…`, so the search silently comes back empty and
 * reads as "that order isn't here".
 *
 * So the separator and prefix are optional on input: "40718", "nb40718",
 * "NB-40718" and "nb 40718" all normalise to the same `NB-40718%`. Only the
 * digits are interpolated, and only after the term matched this shape, so
 * nothing typed here can reach the pattern as a wildcard.
 *
 * Returns undefined for anything else — a name, an email, a phone number —
 * which then matches on the substring branches alone.
 */
function orderNumberMatch(term: string): SQL | undefined {
  const digits = /^(?:nb[\s-]*)?(\d{1,5})$/i.exec(term.trim())?.[1];

  return digits ? ilike(orders.orderNumber, `${ORDER_NUMBER_PREFIX}-${digits}%`) : undefined;
}

/**
 * Free text across the four identifiers a customer might quote.
 *
 * The order number is matched case-insensitively and anchored to the *start*,
 * because it is read off a printed confirmation and typed in whole — a
 * substring match on an eight-character space would turn a search for "40718"
 * into a scan. The other three are substring matches, since a caller might
 * offer half a name or the last digits of a phone number.
 *
 * A bare-digit term keeps the phone branch as well as gaining the order-number
 * one: "40718" is a plausible tail of a phone number, and dropping that match
 * would fix one search by breaking another.
 *
 * Escaped before interpolation. An unescaped `%` typed into a staff search box
 * would match every order in the shop, which looks like a broken filter rather
 * than like the wildcard it is — the same trap catalog search documents.
 */
function textMatch(term: string): SQL {
  const escaped = term.replace(/([\\%_])/g, "\\$1");

  return or(
    ilike(orders.orderNumber, `${escaped}%`),
    orderNumberMatch(term),
    ilike(orders.customerName, `%${escaped}%`),
    ilike(orders.customerEmail, `%${escaped}%`),
    ilike(orders.customerPhone, `%${escaped}%`),
  )!;
}

/**
 * Orders bound for one division.
 *
 * The order stores the district (`shippingAddress.city`), never the division —
 * checkout's cascading picker uses the division only to pick a district and a
 * delivery zone, and neither of those is the division back again ("outside
 * dhaka" is seven of them). So the filter expands to the districts that
 * division contains, from the same list in @sakura/contracts that the picker
 * and the admin dropdown are built from.
 *
 * Compared lower-cased on both sides: the districts arrive from a `<select>`
 * today, but historic orders were typed by hand, and a manifest that silently
 * omits "sylhet" because it was stored uncapitalised is a parcel that doesn't
 * ship.
 */
function divisionMatch(division: string): SQL {
  const districts = districtsFor(division).map((name) => name.toLowerCase());

  // An unknown slug would otherwise build `in ()`, which is a syntax error.
  // The schema's enum makes this unreachable; a false literal keeps it a
  // filter that matches nothing rather than a 500.
  if (districts.length === 0) return sql`false`;

  return inArray(sql`lower(${orders.shippingAddress} ->> 'city')`, districts);
}

export function adminOrderFilters(query: AdminOrderQuery): SQL | undefined {
  const conditions: SQL[] = [];

  if (query.status?.length) conditions.push(inArray(orders.status, query.status));
  if (query.paymentMethod) conditions.push(eq(orders.paymentMethod, query.paymentMethod));
  if (query.q) conditions.push(textMatch(query.q));
  if (query.division) conditions.push(divisionMatch(query.division));

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
