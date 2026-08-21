import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";

/**
 * Does the application's dependency graph actually resolve?
 *
 * This exists because a wiring bug shipped. `AdminPreOrdersService` gained a
 * constructor dependency on a service exported from `PreOrdersModule`, which
 * `AdminModule` did not import — a mistake TypeScript cannot see, because the
 * types are all perfectly valid and the fault is in module metadata that is
 * only read at runtime. Typecheck passed, lint passed, 149 unit tests passed,
 * and the container crash-looped on the first boot in production.
 *
 * That is the whole class of error this closes: everything that is only true
 * once Nest builds the injector. A missing `imports` entry, a provider left
 * out of `providers`, a circular import between two modules, a token that
 * nothing supplies.
 *
 * `compile()` rather than `init()` is the deliberate line. Compiling resolves
 * every dependency and constructs every provider — which is exactly where
 * UnknownDependenciesException is raised — but does not run lifecycle hooks,
 * so `DbService.onModuleInit` never opens a pool and `MongoPaymentsClient`
 * never dials the gateway. The test therefore needs no services, keeps the
 * suite runnable on save, and stays honest about what it checks: the shape of
 * the graph, not the health of anything at the end of a socket.
 */
describe("AppModule", () => {
  /**
   * `validateEnv` runs when ConfigModule is created and refuses to boot
   * without these, so the graph cannot be built without them. Deliberately the
   * minimum: every optional variable is left unset so that this also proves
   * the application wires up in its degraded configuration — no Redis, no
   * webhook secret, and no MONGO_URI, which is the state a fresh deployment is
   * in before anyone fills the panel in.
   */
  const required = {
    DATABASE_URL: "postgres://user:pass@localhost:5432/sakura",
    ADMIN_JWT_SECRET: "0".repeat(32),
    NODE_ENV: "test",
  } as const;

  const saved = new Map<string, string | undefined>();

  beforeAll(() => {
    for (const [key, value] of Object.entries(required)) {
      saved.set(key, process.env[key]);
      process.env[key] = value;
    }
  });

  afterAll(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("resolves every provider in the graph", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    expect(moduleRef).toBeDefined();

    /**
     * Not closed, deliberately. `close()` runs the destroy hooks, and those
     * are the mirror of the init hooks this never ran — `DbService` would try
     * to end a pool it never opened. Nothing here holds a handle to release.
     */
  });
});
