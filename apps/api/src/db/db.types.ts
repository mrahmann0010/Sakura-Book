import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

/** The `tx` handle handed to the callback of `db.transaction(...)`. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Anything that can run a query. Services take this so a caller can pass either
 * the root db (standalone use) or an open transaction (checkout), without the
 * service needing to know which.
 *
 * ---
 *
 * There is no repository layer, and this type is the reason one is not needed.
 *
 * Drizzle is already the data-access abstraction, and it is a query builder:
 * a repository over it either exposes a leaky pass-through (`findMany(where)`)
 * or throws away the composability that makes conditional catalog filtering
 * readable. The usual argument for one — swapping the database later — does
 * not apply to a schema built on Postgres enums, jsonb, partial check
 * constraints and trigram indexes. What a repository *would* have given us is
 * the ability to run the same query inside someone else's transaction, and
 * that is exactly what passing an Executor provides, for one line of types.
 *
 * ---
 *
 * Which of the two to accept is not a matter of taste. It encodes whether a
 * method is safe to run on its own:
 *
 * **Reads, and writes that stand alone → `executor: Executor = this.dbService.db`.**
 * Defaulting to the root db means the method works from a controller, a seed
 * script, or a test with no ceremony, and still joins a transaction when one
 * is handed to it. `CouponsService.evaluate` and `InventoryService.availability`
 * are both this shape.
 *
 * **Writes that are only correct alongside another write → `tx: Transaction`.**
 * No default, and deliberately not `Executor`: `Database` is not assignable to
 * `Transaction`, so a caller who forgot to open one gets a compile error
 * rather than a silently auto-committed partial checkout. `CouponsService.redeem`
 * is the archetype — consuming a coupon use is only ever correct if the order
 * that used it is written in the same breath, so "call this on the root db"
 * is not a use case to support, it is a bug to make unrepresentable.
 *
 * The rule of thumb: if rolling this write back is part of how a caller
 * recovers from a later failure, it takes a Transaction.
 *
 * Note what is *not* here: no transaction-per-request middleware, no
 * AsyncLocalStorage. Implicit transaction scope makes it invisible at the call
 * site whether you are inside one — which is precisely the thing you need to
 * know when you are writing a guarded update and reasoning about who wins a
 * race. The use-case service opens `db.transaction()` and passes the handle
 * down by hand; that verbosity is the feature.
 */
export type Executor = Database | Transaction;
