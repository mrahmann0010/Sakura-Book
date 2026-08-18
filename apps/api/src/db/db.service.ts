import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import type { Env } from "../config/env.schema";
import * as schema from "./schema";

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private client!: Sql;
  db!: PostgresJsDatabase<typeof schema>;

  constructor(private readonly config: ConfigService<Env, true>) {}

  onModuleInit(): void {
    /**
     * The pool is configured rather than left at postgres-js's defaults,
     * because the default that matters here is invisible: 10 connections per
     * instance, multiplied by however many instances are running, against a
     * Postgres `max_connections` nobody re-checks. Making it an env var means
     * that budget is something an operator can see and set.
     *
     * `idle_timeout` returns connections to the pooler during quiet periods —
     * a shop with dozens of titles spends most of its day idle, and holding
     * ten open connections for it is a cost with no benefit. It matters more
     * on Supabase than on a local Postgres: pooler client slots are a metered
     * resource, and idle API instances holding them starve the ones working.
     */
    const ssl = this.config.get("DATABASE_SSL", { infer: true });

    this.client = postgres(this.config.getOrThrow("DATABASE_URL", { infer: true }), {
      max: this.config.get("DATABASE_POOL_MAX", { infer: true }),
      idle_timeout: this.config.get("DATABASE_IDLE_TIMEOUT", { infer: true }),

      // postgres-js takes `false` for "no TLS" and the libpq mode names
      // otherwise, so `disable` has to be translated rather than passed on.
      ssl: ssl === "disable" ? false : ssl,

      /**
       * Off by default, and the reason is the pooler rather than a preference.
       * Supabase's transaction-mode Supavisor hands each statement whichever
       * backend is free, so a statement prepared on one connection is missing
       * on the next — surfacing as `prepared statement "sN" does not exist`
       * under concurrency, which is both intermittent and load-dependent.
       * Session-mode and direct connections can turn it back on.
       */
      prepare: this.config.get("DATABASE_PREPARE", { infer: true }),
    });
    this.db = drizzle(this.client, { schema });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.end();
  }
}
