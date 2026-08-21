import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { hashPassword } from "../../admin/auth/password";
import { adminUsers } from "../schema";
import type { Database } from "../db.types";

/**
 * Create the first admin account.
 *
 * A seed step rather than a signup endpoint, because a self-service
 * registration route on an admin panel is a permanently open door that has to
 * be defended forever — with an invite system, a first-run flag, or a check
 * that the table is empty, all of which are more machinery than "run one
 * command during setup". Every subsequent account is created by this one
 * through `/admin/users`, where it is an audited action by a known person.
 *
 * Idempotent: re-running with an existing email leaves the account untouched
 * rather than resetting its password. A seed script that silently rewrote a
 * live credential every time a pipeline ran would be a way to lock the shop's
 * staff out of their own panel.
 */
export async function seedAdmin(
  db: Database,
  input: { email: string; name: string; password?: string },
): Promise<{ created: boolean; email: string; password?: string }> {
  const email = input.email.trim().toLowerCase();

  const existing = await db.query.adminUsers.findFirst({
    where: eq(adminUsers.email, email),
    columns: { id: true },
  });

  if (existing) return { created: false, email };

  /**
   * A generated password when none is supplied, printed once.
   *
   * The alternative — a documented default like `admin/admin` — is the single
   * most reliable way to end up with a production panel behind a password that
   * is in a README. Generating one means the weak-credential path does not
   * exist to be forgotten, and printing it once means the operator has to
   * write it down somewhere deliberate.
   */
  const password = input.password ?? randomBytes(18).toString("base64url");

  await db.insert(adminUsers).values({
    email,
    name: input.name,
    passwordHash: await hashPassword(password),
    // The bootstrap account is the one that creates the others, so it cannot
    // be STAFF — nothing else would be able to grant the ADMIN role.
    role: "ADMIN",
  });

  return { created: true, email, password: input.password ? undefined : password };
}
