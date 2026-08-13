import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

/** The `tx` handle handed to the callback of `db.transaction(...)`. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Anything that can run a query. Services take this so a caller can pass either
 * the root db (standalone use) or an open transaction (checkout), without the
 * service needing to know which.
 */
export type Executor = Database | Transaction;
