import type { SQL } from "drizzle-orm";
import type { Executor } from "../db/db.types";
import type { OrderRow } from "./order.mapper";

/**
 * One query shape for reading a whole order.
 *
 * Shared by checkout (which returns the order it just wrote) and lookup (which
 * returns it days later) so the two cannot produce differently-populated
 * objects — a customer reloading their confirmation must see exactly what the
 * POST returned, and two hand-written reads is how "the total changed after I
 * refreshed" happens.
 *
 * A function over an `Executor`, not a repository class (§3.2). It exists to
 * name a `with` clause used in two places, and giving that a constructor and a
 * DI token would be the pattern the lint rule forbids, arrived at by habit.
 */
export async function findOrder(executor: Executor, where: SQL): Promise<OrderRow | undefined> {
  return executor.query.orders.findFirst({
    where,
    with: {
      items: { with: { book: { columns: { slug: true, coverImageUrl: true } } } },
      statusHistory: true,
    },
  });
}

/**
 * The same shape as `findOrder`, for a lookup that may legitimately match more
 * than one order — a customer's email or phone can be on several. Newest
 * first and capped, since this backs a customer-facing list, not a report.
 */
export async function findOrders(executor: Executor, where: SQL): Promise<OrderRow[]> {
  return executor.query.orders.findMany({
    where,
    with: {
      items: { with: { book: { columns: { slug: true, coverImageUrl: true } } } },
      statusHistory: true,
    },
    orderBy: (row, { desc }) => [desc(row.createdAt)],
    limit: 20,
  });
}
