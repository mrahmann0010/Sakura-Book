import { existsSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { is, sql } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema";

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

  /* `DATABASE_URL`, and deliberately not `DIRECT_DATABASE_URL` — which this
     used to prefer, and which is how the waitlist queue's tables came to exist
     nowhere the application could see them.

     That preference was written for Supabase, where `DATABASE_URL` was the
     transaction pooler and only the direct connection could hold the session
     state a migration needs. The shop has since moved to the self-hosted
     Postgres beside it, where `DATABASE_URL` *is* a direct connection and
     `DIRECT_DATABASE_URL` was left behind still naming the Supabase pooler. So
     every deploy since the move has faithfully migrated the old database and
     reported success, while the one being served fell further behind. Nothing
     was wrong with either value; the bug is that the migrator was allowed to
     migrate a database the application does not use.

     The rule that replaces it: migrate the connection the server is about to
     open. A stale override is then survivable — warned about below, and
     ignored — rather than silently authoritative.

     If `DATABASE_URL` is ever a transaction pooler again, this needs the old
     split back, and it will say so loudly: the advisory lock is session state,
     and a pooler that hands the unlock to a different backend fails here rather
     than quietly. */
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error("DATABASE_URL is not set — the migrator has no database to migrate.");
  }

  const override = process.env.DIRECT_DATABASE_URL;
  if (override && describe(override) !== describe(url)) {
    console.warn(
      [
        `warning: DIRECT_DATABASE_URL names ${describe(override)}, which is not the`,
        `database the application connects to (${describe(url)}). Ignoring it and`,
        "migrating the application's own database. Delete the variable — a second",
        "database that only migrations can see is how a schema silently splits in two.",
      ].join("\n"),
    );
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

    await assertBaselined(client, url);

    /* Resolves to apps/api/drizzle from both `dist/db` in the image and
       `src/db` under tsx, so the same script serves a deploy and a local
       `npm run db:migrate:deploy` without a second path to keep in step. */
    await migrate(db, { migrationsFolder: join(__dirname, "../../drizzle") });

    console.log(`migrations up to date on ${describe(url)}`);

    /* The same connection that was just migrated, checked independently of
       having migrated it. Bookkeeping saying a migration ran is not evidence
       that its objects are there — that is the whole reason this exists. */
    await assertNoDrift(url);

    console.log(`schema verified on ${describe(url)}`);
  } finally {
    /* Best-effort: if the migration threw, its error is the one worth
       reporting, and the lock dies with the session anyway. */
    await db.execute(sql`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`).catch(() => undefined);
    await client.end();
  }
}

/**
 * Refuse to replay history onto a database that already has most of it.
 *
 * A database restored from somewhere else arrives with the tables but not
 * necessarily with `drizzle.__drizzle_migrations`, and to the migrator an empty
 * bookkeeping table is indistinguishable from an empty database: it starts at
 * 0000 and dies on the first `CREATE TYPE` that already exists. The error it
 * gives for that is about a duplicate object, which sends whoever reads it
 * looking at the wrong migration entirely.
 *
 * Checked before migrating rather than after, because the point is to say this
 * instead of the cascade — and to say it while the database is still untouched.
 */
async function assertBaselined(client: postgres.Sql, url: string): Promise<void> {
  const [{ present }] = await client<{ present: boolean }[]>`
    select to_regclass('drizzle.__drizzle_migrations') is not null as present
  `;

  const applied = present
    ? (await client<{ count: number }[]>`
        select count(*)::int as count from drizzle.__drizzle_migrations
      `)[0].count
    : 0;

  const [{ tables }] = await client<{ tables: number }[]>`
    select count(*)::int as tables
      from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
  `;

  if (applied === 0 && tables > 0) {
    throw new Error(
      [
        `${describe(url)} has ${tables} table(s) but no migration history.`,
        "",
        "Migrating would replay every migration from the beginning onto objects that",
        "already exist. This database was almost certainly restored from another one",
        "without its `drizzle.__drizzle_migrations` table; it needs baselining — the",
        "rows for the migrations its schema already reflects — before a deploy can",
        "carry it forward.",
      ].join("\n"),
    );
  }

  console.log(`${describe(url)}: ${applied} migration(s) recorded, ${tables} table(s)`);
}

/**
 * Every column the code will write, as the schema declares it.
 *
 * Drizzle names *all* of a table's columns in an INSERT — `default` for the
 * ones a caller left out — so a column the code knows about and the database
 * does not breaks every insert into that table, including inserts that never
 * mention it. Reads are narrower and keep working, which is what made the last
 * one of these invisible until a customer hit it: the storefront, the invite
 * lookup and the reservation subquery were all fine while joining the waitlist
 * answered 500.
 */
function expectedColumns(): Map<string, Set<string>> {
  const expected = new Map<string, Set<string>>();

  for (const exported of Object.values(schema)) {
    if (!is(exported, PgTable)) continue;

    const config = getTableConfig(exported as PgTable);
    expected.set(
      config.name,
      new Set(config.columns.map((column) => column.name)),
    );
  }

  return expected;
}

/**
 * Refuse to hand over to a server whose database is not the one it was built
 * against.
 *
 * Checked on `DATABASE_URL` — the connection the *application* uses — and not
 * on the one just migrated, because those are allowed to differ (see the
 * DIRECT_DATABASE_URL note above) and "migrated a different database than the
 * app talks to" is precisely one of the two ways the queue columns went
 * missing. The other is bookkeeping that records a migration nobody applied.
 * Neither shows up in the migrator's own output, and both show up here.
 *
 * Only missing tables and columns are reported. Type and nullability drift is
 * real but needs judgement to act on, and a deploy gate that fires on a widened
 * varchar is a gate somebody switches off.
 */
async function assertNoDrift(runtimeUrl: string): Promise<void> {
  const client = postgres(runtimeUrl, {
    max: 1,
    ssl: process.env.DATABASE_SSL === "disable" ? false : "require",
  });

  try {
    const live = await client<{ table_name: string; column_name: string }[]>`
      select table_name, column_name
        from information_schema.columns
       where table_schema = 'public'
    `;

    const actual = new Map<string, Set<string>>();
    for (const { table_name, column_name } of live) {
      const columns = actual.get(table_name) ?? new Set<string>();
      columns.add(column_name);
      actual.set(table_name, columns);
    }

    const problems: string[] = [];

    for (const [table, columns] of expectedColumns()) {
      const present = actual.get(table);

      if (!present) {
        problems.push(`table "${table}" is missing entirely`);
        continue;
      }

      const missing = [...columns].filter((column) => !present.has(column));
      if (missing.length > 0) {
        problems.push(`table "${table}" is missing: ${missing.join(", ")}`);
      }
    }

    if (problems.length > 0) {
      throw new Error(
        [
          `The database at ${describe(runtimeUrl)} does not match the schema this build ships:`,
          ...problems.map((problem) => `  - ${problem}`),
          "",
          "Migrations reported success, so either they were applied to a different",
          "database than DATABASE_URL points at, or its bookkeeping records a migration",
          "that never ran. Both are repaired by a migration that has not been recorded",
          "yet — see drizzle/0037_waitlist_queue_repair.sql for the shape of one.",
        ].join("\n"),
      );
    }
  } finally {
    await client.end();
  }
}

/** Host and database only — the password is in this URL. */
function describe(url: string): string {
  try {
    const parsed = new URL(url);

    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return "the configured database";
  }
}

main().catch((error: unknown) => {
  console.error("migration failed:", error);
  // Non-zero, so the `&&` in the container's start command stops here and the
  // deploy fails loudly instead of booting against a schema it cannot trust.
  process.exit(1);
});
