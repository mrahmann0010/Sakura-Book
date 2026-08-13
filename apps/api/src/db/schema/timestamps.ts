import { timestamp } from "drizzle-orm/pg-core";

/**
 * Shared created_at/updated_at columns.
 *
 * All timestamps are timestamptz: orders, payments and status transitions are
 * cross-timezone events, so the offset is part of the fact being recorded.
 * updated_at is maintained by Drizzle on write ($onUpdate) rather than by a
 * database trigger, so it only moves for writes that go through the ORM.
 */
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};
