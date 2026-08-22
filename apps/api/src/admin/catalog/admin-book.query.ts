import { and, asc, desc, eq, ilike, type SQL } from "drizzle-orm";
import type { AdminBookQuery } from "@sakura/contracts";
import { books } from "../../db/schema";

/**
 * `where` and `order by` for the admin book list, built from validated params.
 *
 * Split from the service for the same reason catalog/book.query.ts and
 * admin/orders/admin-order.query.ts are. Unlike the storefront's `bookFilters`,
 * there is no forced `isActive` condition — this is the admin's own list, and
 * hiding an inactive title from the person who has to reactivate it would
 * defeat the point of a deactivate/reactivate toggle.
 */

function textMatch(term: string): SQL {
  const escaped = term.replace(/([\\%_])/g, "\\$1");
  return ilike(books.title, `%${escaped}%`);
}

export function adminBookFilters(query: AdminBookQuery): SQL | undefined {
  const conditions: SQL[] = [];

  if (query.q) conditions.push(textMatch(query.q));
  if (query.isActive !== undefined) conditions.push(eq(books.isActive, query.isActive));
  if (query.isFeatured !== undefined) conditions.push(eq(books.isFeatured, query.isFeatured));

  return conditions.length ? and(...conditions) : undefined;
}

/** Sort, with a stable tiebreak — see the same note in every other admin query.ts. */
export function adminBookOrder(sort: AdminBookQuery["sort"]): SQL[] {
  switch (sort) {
    case "title":
      return [asc(books.title), asc(books.id)];
    case "price-asc":
      return [asc(books.priceCents), asc(books.id)];
    case "stock-asc":
      return [asc(books.stockQuantity), asc(books.id)];
    case "recent":
    default:
      return [desc(books.createdAt), asc(books.id)];
  }
}
