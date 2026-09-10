import { existsSync, readFileSync } from "node:fs";
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

/* --------------------------------------------------------------------------
   Saying what happened, loudly enough to find later.

   This script's output is read in exactly one place — a deploy log, scrolling
   past, interleaved with Nest's own startup chatter — and usually by somebody
   who came looking because the site is wrong. It used to say three sentences,
   all of them lowercase, one of which ("migrations up to date on …") was the
   line that spent weeks reporting success about a database nobody was using.

   So every line is prefixed with a fixed marker, and the phases are bracketed
   by rules. The marker is what makes `grep MIGRATE` a complete answer, and the
   rules are what make the block findable by eye at scrolling speed. Deliberately
   no ANSI colour: it renders as garbage in half the places these logs get
   forwarded to, and the point is to be legible everywhere rather than pretty in
   one terminal.
   -------------------------------------------------------------------------- */

const MARKER = "MIGRATE │";
const RULE = "─".repeat(68);

/** A phase heading — the lines you should be able to find by eye. */
function phase(text: string): void {
  console.log(`${MARKER} ${RULE}`);
  console.log(`${MARKER} ${text}`);
  console.log(`${MARKER} ${RULE}`);
}

/** One detail under the current phase. */
function detail(text: string): void {
  console.log(`${MARKER}   ${text}`);
}

/** A step's outcome. `ok` reads as a tick, so a scan down the column is enough. */
function result(status: "OK" | "SKIP" | "WARN", text: string): void {
  console.log(`${MARKER} [${status.padEnd(4)}] ${text}`);
}

/** Whole seconds are useless here and three decimals are noise. */
function elapsed(since: number): string {
  return `${((Date.now() - since) / 1000).toFixed(2)}s`;
}

/**
 * Postgres NOTICEs, in this block's format rather than as dumped objects.
 *
 * postgres.js prints the whole notice structure — severity, file, line number
 * of the C source that raised it — straight to stdout, which lands a
 * nine-line object in the middle of the phases every time a guarded
 * `create … if not exists` skips. Drizzle's own bookkeeping raises two of
 * those on every single run.
 *
 * Kept rather than silenced: the guarded statements in 0037-style repair
 * migrations report what they skipped this way, and that is worth reading. It
 * is only the shape that was wrong.
 */
function reportNotice(notice: postgres.Notice): void {
  detail(`notice: ${notice.message}`);
}

/**
 * Which migrations are about to run, named, before they run.
 *
 * `migrate()` reports nothing at all — not what it applied, not whether it
 * applied anything — so a deploy log could never answer "did 0038 land here?"
 * except by inference from the absence of a crash. That is precisely the
 * question the last three weeks were spent on.
 *
 * Mirrors drizzle's own selection rule rather than inventing one: the journal
 * is ordered, each entry carries a `when`, and a migration is pending when its
 * `when` is newer than the newest `created_at` in the bookkeeping table. Read
 * only for reporting — `migrate()` still decides what it actually applies, so a
 * disagreement here can mislabel the log but can never migrate the wrong thing.
 */
async function pendingMigrations(client: postgres.Sql, folder: string): Promise<string[]> {
  type JournalEntry = { when: number; tag: string };

  let journal: { entries?: JournalEntry[] };
  try {
    journal = JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8")) as {
      entries?: JournalEntry[];
    };
  } catch {
    // Not fatal: `migrate()` is about to fail on the same folder and its error
    // will be the better one. Reporting "unknown" beats inventing a list.
    return [];
  }

  const entries = journal.entries ?? [];

  const [{ latest }] = await client<{ latest: string | null }[]>`
    select max(created_at)::text as latest
      from drizzle.__drizzle_migrations
     where to_regclass('drizzle.__drizzle_migrations') is not null
  `.catch(() => [{ latest: null }] as { latest: string | null }[]);

  const applied = latest === null ? -1 : Number(latest);

  return entries.filter((entry) => entry.when > applied).map((entry) => entry.tag);
}

async function main(): Promise<void> {
  const startedAt = Date.now();
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

  phase("STARTED — applying database migrations before the server boots");
  detail(`target:  ${describe(url)}`);
  detail(`ssl:     ${process.env.DATABASE_SSL === "disable" ? "disabled" : "required"}`);

  const override = process.env.DIRECT_DATABASE_URL;
  if (override && describe(override) !== describe(url)) {
    result("WARN", `ignoring DIRECT_DATABASE_URL, which names ${describe(override)}`);
    console.warn(
      [
        `${MARKER}   That is not the database the application connects to`,
        `${MARKER}   (${describe(url)}). Migrating the application's own database.`,
        `${MARKER}   Delete the variable — a second database that only migrations`,
        `${MARKER}   can see is how a schema silently splits in two.`,
      ].join("\n"),
    );
  }

  // `max: 1` is required rather than tidy: the lock is held on a session, so a
  // pool free to answer the unlock on a different connection would leave the
  // real one held until the process exits.
  const client = postgres(url, {
    max: 1,
    ssl: process.env.DATABASE_SSL === "disable" ? false : "require",
    onnotice: reportNotice,
  });

  const db = drizzle(client);

  try {
    detail("waiting for the migration advisory lock…");
    await db.execute(sql`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`);
    result("OK", "advisory lock held — this container is the one migrating");

    await assertBaselined(client, url);

    /* Resolves to apps/api/drizzle from both `dist/db` in the image and
       `src/db` under tsx, so the same script serves a deploy and a local
       `npm run db:migrate:deploy` without a second path to keep in step. */
    const folder = join(__dirname, "../../drizzle");

    const pending = await pendingMigrations(client, folder);

    if (pending.length === 0) {
      phase("APPLYING — nothing pending, the database is already current");
    } else {
      phase(`APPLYING — ${pending.length} pending migration(s)`);
      for (const tag of pending) detail(`→ ${tag}`);
    }

    const appliedAt = Date.now();
    await migrate(db, { migrationsFolder: folder });

    if (pending.length === 0) {
      result("SKIP", `no migrations to apply (${elapsed(appliedAt)})`);
    } else {
      for (const tag of pending) result("OK", `applied ${tag}`);
      result("OK", `${pending.length} migration(s) applied in ${elapsed(appliedAt)}`);
    }

    /* The same connection that was just migrated, checked independently of
       having migrated it. Bookkeeping saying a migration ran is not evidence
       that its objects are there — that is the whole reason this exists. */
    phase("VERIFYING — does the live schema match the code this build ships?");
    await assertNoDrift(url);
    result("OK", `schema verified on ${describe(url)}`);

    phase(`SUCCESSFUL — database ready in ${elapsed(startedAt)}, handing over to the server`);
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
  phase("CHECKING — is this database safe to migrate?");

  const [{ present }] = await client<{ present: boolean }[]>`
    select to_regclass('drizzle.__drizzle_migrations') is not null as present
  `;

  const applied = present
    ? (
        await client<{ count: number }[]>`
        select count(*)::int as count from drizzle.__drizzle_migrations
      `
      )[0].count
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

  result("OK", `baseline sane — ${applied} migration(s) recorded, ${tables} table(s) present`);
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
    expected.set(config.name, new Set(config.columns.map((column) => column.name)));
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
    onnotice: reportNotice,
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
  /* On stderr, and shaped like the phases above so the failure is found by the
     same scan that finds the success. The message goes on its own lines rather
     than after a colon: these errors are deliberately several sentences long —
     see `assertBaselined` and `assertNoDrift` — and a multi-line string tacked
     onto a prefix loses its shape in most log viewers. */
  const message = error instanceof Error ? error.message : String(error);

  console.error(`${MARKER} ${RULE}`);
  console.error(`${MARKER} FAILED — migrations did not complete. The server will NOT start.`);
  console.error(`${MARKER} ${RULE}`);
  for (const line of message.split("\n")) console.error(`${MARKER}   ${line}`);
  console.error(`${MARKER} ${RULE}`);

  /* The stack, unprefixed and last. Nobody greps for it, and wrapping the
     frames would only make them harder to read in the one case they matter. */
  if (error instanceof Error && error.stack) console.error(error.stack);

  // Non-zero, so the `&&` in the container's start command stops here and the
  // deploy fails loudly instead of booting against a schema it cannot trust.
  process.exit(1);
});
