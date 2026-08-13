import { defineConfig } from "drizzle-kit";
import { join } from "node:path";

// drizzle-kit runs outside the Nest app, so ConfigModule never loads. Pull the
// same root .env that docker compose and the app share.
process.loadEnvFile(join(__dirname, "..", "..", ".env"));

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set — check the .env at the repo root.");
}

export default defineConfig({
  // Glob rather than index.ts: drizzle-kit picks up new schema files without
  // needing the barrel to be updated first.
  schema: "./src/db/schema/**/*.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // No `casing` setting: every column declares its snake_case name explicitly,
  // and a casing rule here would have to be mirrored in drizzle() at runtime.
  verbose: true,
  strict: true,
});
