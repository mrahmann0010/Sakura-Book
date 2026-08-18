/**
 * Assembles the database URLs from a separately-stored password.
 *
 * The two connection strings differ only in port, so keeping the password
 * inline meant writing the same secret twice and re-encoding it twice. Instead
 * the .env holds one `DATABASE_PASSWORD` and the URLs carry a literal
 * `${DATABASE_PASSWORD}` placeholder, resolved here.
 *
 * This is done by hand rather than through dotenv's variable expansion because
 * expansion is not available everywhere the .env is read: `drizzle-kit` and the
 * seed script load it through Node's builtin `process.loadEnvFile`, which does
 * no interpolation at all. A helper that all three entrypoints call is the only
 * version of this that behaves identically in all three.
 */

// Two forms: `.test()` on a /g regex advances `lastIndex` and would report
// false on every other call, so the check and the replace use separate values.
const PLACEHOLDER_TOKEN = "${DATABASE_PASSWORD}";
const PLACEHOLDER = /\$\{DATABASE_PASSWORD\}/g;

/**
 * Substitutes the password into `url`, percent-encoding it on the way in.
 *
 * The encoding is the point of doing this in code: a password containing `@`,
 * `/`, `#` or `:` silently changes where the URL parser thinks the host begins,
 * and the resulting failure is an authentication error that points nowhere near
 * the cause. Callers therefore put the raw password in .env, unquoted and
 * unescaped, exactly as Supabase generated it.
 *
 * A url with no placeholder is returned untouched, so a full inline connection
 * string — a plain local Postgres, or a CI secret injected whole — keeps working.
 */
export function resolveDbUrl(url: string | undefined, password: string | undefined): string | undefined {
  if (!url || !url.includes(PLACEHOLDER_TOKEN)) return url;

  if (!password) {
    throw new Error(
      "A connection string references ${DATABASE_PASSWORD} but DATABASE_PASSWORD is not set — check apps/api/.env.",
    );
  }

  return url.replace(PLACEHOLDER, encodeURIComponent(password));
}

/**
 * Resolves both connection strings in an environment-shaped record, returning a
 * copy. Called before validation so the schema only ever sees final URLs, and
 * before any client is constructed in the scripts that run outside Nest.
 */
export function resolveDbUrls<T extends Record<string, unknown>>(raw: T): T {
  const password = raw.DATABASE_PASSWORD as string | undefined;

  return {
    ...raw,
    DATABASE_URL: resolveDbUrl(raw.DATABASE_URL as string | undefined, password),
    DIRECT_DATABASE_URL: resolveDbUrl(raw.DIRECT_DATABASE_URL as string | undefined, password),
  };
}
