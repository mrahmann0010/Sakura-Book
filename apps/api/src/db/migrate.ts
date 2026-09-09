import { existsSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import postgres from "postgres";

/* --------------------------------------------------------------------------
   Apply pending migrations, then get out of the way.

   Runs as the first half of the container's start command, so a deploy
   migrates before it serves. That is not a convenience: this database accepts
   connections only from the host it runs on, so the deploy is the one context
   that can reach it without an SSH tunnel or a port opened to the internet —
   and the port cannot be opened, because the connection is plaintext
   (DATABASE_SSL=disable) and the password would cross it in the clear.

   Deliberately not `drizzle-kit migrate`. drizzle-kit is a devDependency and
   the runtime image is installed with --omit=dev; adding it back would pull a
   CLI and its bundler into production to run one function that `drizzle-orm`
   — already a dependency here — exports. What the image does need is the
   `drizzle/` folder itself, which the Dockerfile copies alongside dist.

   Failure exits non-zero, which stops the container before Nest boots. That is
   the intended behaviour: Coolify's health check never passes, the old
   container keeps serving, and a broken migration is a failed deploy rather
   than a running app against a half-migrated schema.
   -------------------------------------------------------------------------- */

/**
 * Only one container may migrate at a time.
 *
 * `drizzle-kit`'s own runner assumes it is alone. Two replicas starting
 * together both find the same migration pending and both apply it — and the
 * loser fails on a duplicate object rather than politely doing nothing, which
 * would fail a deploy for no reason. A session-level advisory lock serialises
 * them: the second waits, then finds nothing left to do.
 *
 * The number is arbitrary but must never change — it is the identity of this
 * lock, and a new value would mean a new lock that the other container is not
 * waiting on.
 */
const MIGRATION_LOCK_KEY = 6_120_240_913n;

async function main(): Promise<void> {
  /* Present in development, absent in the container, where Coolify injects the
     environment directly. Loading it unconditionally would throw in exactly
     the place this script matters most. */
  const envFile = join(__dirname, "../../.env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  /* Same precedence and the same reasoning as drizzle.config.ts: the direct
     connection, never a transaction pooler. A pooler hands consecutive
     statements to different backends, and both the advisory lock below and
     drizzle's own migration bookkeeping are session state. */
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;

  if (!url) {
    throw new Error("DATABASE_URL is not set — the migrator has no database to migrate.");
  }

  // `max: 1` is required rather than tidy: the lock is held on a session, so a
  // pool free to answer the unlock on a different connection would leave the
  // real one held until the process exits.
  const client = postgres(url, {
    max: 1,
    ssl: process.env.DATABASE_SSL === "disable" ? false : "require",
  });

  const db = drizzle(client);

  try {
    await db.execute(sql`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`);

    /* Resolves to apps/api/drizzle from both `dist/db` in the image and
       `src/db` under tsx, so the same script serves a deploy and a local
       `npm run db:migrate:deploy` without a second path to keep in step. */
    await migrate(db, { migrationsFolder: join(__dirname, "../../drizzle") });

    console.log("migrations up to date");
  } finally {
    /* Best-effort: if the migration threw, its error is the one worth
       reporting, and the lock dies with the session anyway. */
    await db.execute(sql`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`).catch(() => undefined);
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error("migration failed:", error);
  // Non-zero, so the `&&` in the container's start command stops here and the
  // deploy fails loudly instead of booting against a schema it cannot trust.
  process.exit(1);
});
