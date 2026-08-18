import { defineConfig } from "drizzle-kit";
import { join } from "node:path";
import { resolveDbUrl } from "./src/config/db-url";

// drizzle-kit runs outside the Nest app, so ConfigModule never loads. Pull the
// same .env the app itself uses.
process.loadEnvFile(join(__dirname, ".env"));

/**
 * Migrations run over the direct/session connection, never the transaction
 * pooler. A pooler hands consecutive statements different backends, and
 * `drizzle-kit migrate` holds session state across them — the resulting
 * failures are intermittent, which is the worst way for a migration to break.
 * Falls back to DATABASE_URL for a plain Postgres, where the two are the same.
 */
// The password lives in its own var and the URLs carry a placeholder; see
// src/config/db-url.ts. Node's `loadEnvFile` does no interpolation of its own,
// which is exactly why that substitution is a function rather than dotenv config.
const migrationUrl = resolveDbUrl(
  process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL,
  process.env.DATABASE_PASSWORD,
);

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
