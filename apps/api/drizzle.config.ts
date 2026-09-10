import { defineConfig } from "drizzle-kit";
import { join } from "node:path";

// drizzle-kit runs outside the Nest app, so ConfigModule never loads. Pull the
// same .env the app itself uses.
process.loadEnvFile(join(__dirname, ".env"));

/**
 * The database the application connects to, and no other.
 *
 * This preferred DIRECT_DATABASE_URL until that variable, left over from
 * Supabase and never updated after the move to the self-hosted Postgres, sent
 * a year of migrations to a database nothing reads — see the long note in
 * `src/db/migrate.ts`, which now applies the same rule. A migrator pointed
 * somewhere other than the server is pointed produces a schema that is correct
 * everywhere except where it matters.
 *
 * The pooler warning that used to live here still stands, and is now the one
 * reason to reintroduce a split: `drizzle-kit migrate` holds session state
 * across statements, and a transaction pooler hands consecutive statements to
 * different backends. If DATABASE_URL ever names a pooler again, migrations
 * need a session connection to that *same* database.
 */
const migrationUrl = process.env.DATABASE_URL;

if (!migrationUrl) {
  throw new Error("DATABASE_URL is not set — check apps/api/.env.");
}

export default defineConfig({
  // Glob rather than index.ts: drizzle-kit picks up new schema files without
  // needing the barrel to be updated first.
  schema: "./src/db/schema/**/*.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: migrationUrl,
    // Supabase terminates TLS on the pooler and on the direct host alike. The
    // certificate is not verified here for the same reason `require` is the
    // app's default: verification needs Supabase's CA distributed to every
    // machine that runs a migration.
    ssl: process.env.DATABASE_SSL === "disable" ? false : "require",
  },
  // No `casing` setting: every column declares its snake_case name explicitly,
  // and a casing rule here would have to be mirrored in drizzle() at runtime.
  verbose: true,
  strict: true,
});
