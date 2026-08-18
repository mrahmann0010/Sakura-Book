import { defineConfig } from "vitest/config";

/**
 * Unit tests only, and that is the scope on purpose.
 *
 * These cover the pure logic that carries the money rules — the delivery
 * ladder, the discount computation, the status transition map, the catalog's
 * sort and filter fragments. Nothing here touches a database, so the suite
 * runs in CI with no services and stays fast enough to run on save.
 *
 * The interesting *other* bugs in this codebase are concurrency and constraint
 * bugs: the guarded stock decrement, the idempotency replay, the coupon
 * redemption race. Those are deliberately not unit-tested, because a mocked
 * Drizzle cannot have a unique index and a test that mocks the race away
 * proves only that the mock agrees with itself. They belong to an e2e suite
 * against a real disposable Postgres (§3.18), which is the next thing to add.
 */
export default defineConfig({
  test: {
    include: ["test/unit/**/*.spec.ts"],
    environment: "node",
    // No globals: `import { describe, it, expect } from "vitest"` keeps the
    // test files honest about what they depend on, matching how src is written.
    globals: false,
  },
});
