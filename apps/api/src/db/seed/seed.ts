import { drizzle } from "drizzle-orm/postgres-js";
import { join } from "node:path";
import postgres from "postgres";
import * as schema from "../schema";
import { seedReference } from "./reference";
import { seedSampleCatalog } from "./sample-catalog";

/**
 * `npm run db:seed` — reference data always, sample catalog only in dev.
 *
 * Runs outside Nest, like drizzle-kit does, so it loads apps/api/.env by
 * hand rather than through ConfigModule. Two reasons it is not a Nest command:
 * booting the app to write rows drags in every module's lifecycle hooks, and
 * this has to be runnable in a release pipeline where the app is not up yet.
 *
 * Migrations are *not* run here (§3.19). `drizzle-kit migrate` is its own
 * deploy step, because two app instances booting at once must not both try to
 * migrate — folding the two together is how that guarantee gets lost.
 */
async function main(): Promise<void> {
  process.loadEnvFile(join(__dirname, "..", "..", "..", ".env"));

  /**
   * The direct/session connection, not the pooled one. The seed runs many
   * statements in sequence and is exactly the kind of client that transaction
   * pooling breaks in intermittent ways — same reasoning as drizzle-kit, see
   * DIRECT_DATABASE_URL in config/env.schema.ts.
   */
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set — check apps/api/.env.");

  const client = postgres(url, {
    max: 1,
    ssl: process.env.DATABASE_SSL === "disable" ? false : "require",
    prepare: false,
  });
  const db = drizzle(client, { schema });

  try {
    await seedReference(db);
    console.log("Seeded reference data: delivery regions, categories.");

    /**
     * The guard, and it is the point of the file being split in two.
     *
     * The sample titles are placeholder data that PRODUCT.md forbids
     * presenting as the real shelf. `--sample` alone is not enough to load
     * them — NODE_ENV has to say development too, so that a pipeline which
     * copies a dev seed command into a release job fails loudly instead of
     * quietly publishing nine invented books.
     */
    const wantsSample = process.argv.includes("--sample");
    const isDevelopment = (process.env.NODE_ENV ?? "development") === "development";

    if (wantsSample && !isDevelopment) {
      throw new Error(
        `Refusing to seed the sample catalog with NODE_ENV=${process.env.NODE_ENV}. ` +
          "These are placeholder titles, not the shop's real inventory.",
      );
    }

    if (wantsSample) {
      await seedSampleCatalog(db);
      console.log("Seeded the sample catalog: 9 placeholder titles, 2 coupons, no reviews.");
    } else {
      console.log("Skipped the sample catalog. Pass --sample in development to load it.");
    }
  } finally {
    await client.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
