import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { ADMIN_ROLES, type AdminRole } from "@sakura/contracts";
import * as schema from "../schema";
import { seedAdmin } from "../seed/admin";

/**
 * `npm run db:admin-create -- --email=packer@shop.com --name="Karim" --role=FULFILLMENT`
 *
 * Adds one panel account from the server, for as long as the panel has no
 * staff screen of its own. The seed's bootstrap path with a role attached —
 * see `seedAdmin` — so it shares that path's two rules:
 *
 * - **Idempotent.** An email that already has an account is reported and left
 *   alone, never reset. Changing someone's role or password is not what a
 *   "create" command should be able to do by accident.
 * - **The password is generated and printed once**, unless
 *   ADMIN_BOOTSTRAP_PASSWORD is set. Hand it over in person; the account's
 *   owner should change it at first sign-in.
 *
 * `--role` is required rather than defaulting, because the default that suits
 * the bootstrap (ADMIN) is the wrong one to hand a new packer by forgetting a
 * flag.
 */

function readFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);

  return value?.trim() || undefined;
}

function isAdminRole(value: string): value is AdminRole {
  return (ADMIN_ROLES as readonly string[]).includes(value);
}

async function main(): Promise<void> {
  process.loadEnvFile(join(__dirname, "..", "..", "..", ".env"));

  const email = readFlag("email");
  const name = readFlag("name");
  const role = readFlag("role")?.toUpperCase();

  if (!email || !name || !role) {
    throw new Error(
      'Usage: npm run db:admin-create -- --email=<email> --name="<name>" ' +
        `--role=<${ADMIN_ROLES.join("|")}>`,
    );
  }

  if (!isAdminRole(role)) {
    throw new Error(`Unknown role "${role}". Expected one of: ${ADMIN_ROLES.join(", ")}.`);
  }

  // The same connection choice as the seed, for the same reasons.
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set — check apps/api/.env.");

  const client = postgres(url, {
    max: 1,
    ssl: process.env.DATABASE_SSL === "disable" ? false : "require",
    prepare: false,
  });

  try {
    const result = await seedAdmin(drizzle(client, { schema }), {
      email,
      name,
      role,
      password: process.env.ADMIN_BOOTSTRAP_PASSWORD,
    });

    if (!result.created) {
      console.log(`An account for ${result.email} already exists — left unchanged.`);
    } else if (result.password) {
      // Printed once and never recoverable. Deliberately console, not pino:
      // this must not end up in a structured log shipper.
      console.log(`\nCreated ${role} account ${result.email}`);
      console.log(`Password (shown once): ${result.password}\n`);
    } else {
      console.log(`Created ${role} account ${result.email} with ADMIN_BOOTSTRAP_PASSWORD.`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
