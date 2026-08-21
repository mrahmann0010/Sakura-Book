import { z } from "zod";

/**
 * Every environment variable the API depends on, validated once at boot.
 * A missing or malformed var fails startup here rather than surfacing as a
 * mystery `undefined` deep in a request handler.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),

  /**
   * The connection the *application* uses, password and all. On Supabase this
   * is the Supavisor transaction-mode pooler (port 6543), which is what the
   * platform expects a long-running server to hold: it multiplexes many short
   * transactions over few server connections, which is the shape this API has.
   *
   * The password goes inline in this string. It used to live in its own
   * DATABASE_PASSWORD var that a helper substituted into a `${...}` placeholder,
   * which read well in a .env file and broke everywhere else: Docker Compose
   * and most hosting panels interpolate `${...}` in their own layer before the
   * process starts, so the placeholder was resolved — often to nothing — before
   * this code could resolve it. One complete URL per environment survives that.
   *
   * A password with `@ : / # ? %` in it must be percent-encoded by hand now
   * that nothing encodes it on the way in; unencoded, those characters move
   * where the URL parser thinks the host begins and the failure surfaces as an
   * authentication error pointing nowhere near the cause. Supabase can
   * regenerate the password if that is easier than escaping it.
   */
  DATABASE_URL: z.string().url(),

  /**
   * A session-mode or direct connection, used only by drizzle-kit and the seed
   * script. Falls back to DATABASE_URL when unset.
   *
   * Separate because migrations are not the same workload as request handling.
   * Transaction-mode pooling hands a different backend to each statement, which
   * breaks anything relying on session state — advisory locks, `SET` that must
   * outlive a statement, some DDL sequences. `drizzle-kit migrate` is exactly
   * that kind of client, and the failure when it is pooled is intermittent
   * rather than loud, which is the worst way for a migration to be wrong.
   *
   * On Supabase this is the session pooler (port 5432). The direct
   * `db.<ref>.supabase.co` host also works, but it resolves to IPv6 only on
   * newer projects, which quietly fails on IPv4-only CI runners.
   */
  DIRECT_DATABASE_URL: z.string().url().optional(),

  /**
   * TLS mode. `require` encrypts without verifying the server certificate,
   * which is what Supabase's poolers expect and what `sslmode=require` means in
   * libpq. `verify-full` additionally checks the chain and hostname and needs
   * Supabase's CA certificate configured; `disable` is for a plain local
   * Postgres with no TLS at all.
   *
   * Defaulted to `require` rather than `disable`, so the insecure setting is
   * one somebody has to type. A managed database reached over the public
   * internet without TLS is a credential and a customer's address in plaintext.
   */
  DATABASE_SSL: z.enum(["disable", "require", "verify-full"]).default("require"),

  /**
   * Whether postgres-js may use prepared statements.
   *
   * Off by default, because a transaction-mode pooler gives consecutive
   * statements different backend connections and a statement prepared on one is
   * not there on the next — producing `prepared statement "s1" does not exist`
   * under concurrency, i.e. exactly when it is least welcome. Turn it on only
   * for a session-mode or direct connection, where it is a genuine saving.
   */
  DATABASE_PREPARE: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .default(false)
    .transform((value) => value === true || value === "true"),

  /** Origin allowed to call this API from the browser (the Next.js app). */
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),

  /**
   * ISO 4217 code for every monetary amount the API emits. One currency only —
   * the schema stores bare `*_cents` integers with no currency column, so
   * supporting a second one is a migration, not a config change.
   *
   * BDT, matching the delivery regions and the cash-on-delivery / bKash
   * payment methods. The `£` in the placeholder catalog and the "posted from
   * Bristol" copy are leftovers to be corrected, not a second currency.
   *
   * Note on minor units: the column names say `cents`, and for BDT the minor
   * unit is poisha. Amounts stay integers of 1/100 taka for consistency with
   * the schema even though poisha are not used in practice — every real price
   * is simply a multiple of 100. Clients should format with zero fraction
   * digits rather than rendering a meaningless `.00`.
   */
  CURRENCY: z.string().length(3).default("BDT"),

  /**
   * Flat postage in minor units, charged below the free-delivery threshold.
   * ৳60 — a typical inside-Dhaka courier rate. ASSUMPTION, not a quoted price:
   * confirm against whatever courier the shop actually uses, and note that a
   * single flat rate cannot express the usual inside/outside-Dhaka split. If
   * that split is needed, it becomes a per-region rate on the regions table
   * (Phase 1) rather than a bigger number here.
   */
  DELIVERY_FLAT_CENTS: z.coerce.number().int().nonnegative().default(6000),

  /**
   * Subtotal in minor units at or above which postage is waived. ৳1,500 —
   * roughly two to three books, so the threshold is reachable but not
   * automatic. A marketing lever; expect it to move.
   */
  FREE_DELIVERY_THRESHOLD_CENTS: z.coerce.number().int().nonnegative().default(150000),

  /**
   * The division the shop currently ships from. The fallback for
   * `shop_settings.origin_division` — same "environment until saved" relationship
   * as the two constants above.
   *
   * Zone pricing compares a customer's destination division against this
   * rather than assuming Dhaka: the shipment point moves (a different
   * warehouse, a publisher shipping direct), and this is what lets it move
   * without a code deploy once staff can edit it from Settings.
   */
  WAREHOUSE_DIVISION: z.string().trim().min(1).default("dhaka"),

  /**
   * Connection string for the Redis that docker compose already provisions.
   *
   * Optional, and the throttler falls back to per-instance in-memory counters
   * without it. That fallback is fine for local development and wrong in
   * production for a specific reason: the limits on coupon validation and
   * order lookup exist to stop enumeration, and with two API instances and
   * in-memory counters an attacker gets two buckets. `main.ts` warns at boot
   * when this is unset outside development rather than failing, because a
   * missing rate-limit backend should not take the shop offline.
   */
  REDIS_URL: z.string().url().optional(),

  /**
   * Shared secret for verifying payment webhooks (HMAC-SHA256 over the raw
   * request body).
   *
   * Optional, and its absence is a closed door rather than an open one: with no
   * secret configured, `ManualTransferProvider.verifyWebhook` rejects every
   * request. That is the right default for a value whose only job is to decide
   * whether something may confirm that an order has been paid for — a missing
   * secret must never mean "skip the check".
   */
  PAYMENTS_WEBHOOK_SECRET: z.string().min(16).optional(),

  /**
   * Maximum Postgres connections held by one API instance.
   *
   * postgres-js defaults to 10. Explicit because the number that matters is
   * per-instance × instances, and on Supabase that product is measured against
   * the pooler's client limit rather than against `max_connections` — a small
   * project's pooler allows far fewer clients than the database would.
   */
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  /** Seconds an idle pooled connection is kept before being closed. */
  DATABASE_IDLE_TIMEOUT: z.coerce.number().int().nonnegative().default(30),
  /**
   * IANA zone the shop's business day runs on.
   *
   * The dashboard's "today", "last 7 days" and "last 30 days" are computed
   * against this rather than against UTC, and the difference is not cosmetic:
   * Dhaka is UTC+6, so every order placed after 6pm local time falls on the
   * *next* UTC day. A dashboard reading in UTC would show a shop's busiest
   * hours as tomorrow's takings, and "orders today" would be wrong by a
   * quarter of the day, every day.
   *
   * Passed to Postgres as an `AT TIME ZONE` argument, so the boundaries are
   * computed where the rows are and daylight-saving rules — irrelevant for
   * Dhaka, but not for a zone this might later be set to — are the database's
   * problem rather than a date library's.
   */
  SHOP_TIMEZONE: z.string().min(1).default("Asia/Dhaka"),

  /**
   * Signing key for admin access tokens. HMAC-SHA256, so this is a shared
   * secret rather than a key pair — there is one service issuing and one
   * verifying, and asymmetric signing solves a distribution problem this
   * deployment does not have.
   *
   * Required in production and optional elsewhere, which is the reverse of how
   * most secrets are treated and is deliberate: a *default* signing key is
   * worse than a missing one, because it silently works. `validateEnv` refuses
   * to boot a production process without it (see the refinement below), while
   * a developer running the API against a local Postgres gets a random
   * per-boot key and is signed out on every restart — mildly annoying, and
   * annoying in the direction that cannot leak.
   *
   * 32 characters minimum: `openssl rand -base64 32`.
   */
  ADMIN_JWT_SECRET: z.string().min(32).optional(),

  /**
   * Access-token lifetime in seconds. Fifteen minutes.
   *
   * Short because the token is a bearer credential the server does not consult
   * a table for — its lifetime is the window in which a stolen one keeps
   * working. It is not the *whole* revocation story: `admin_users.sessions_valid_from`
   * invalidates outstanding tokens immediately, and this bounds the damage
   * from a leak nobody has noticed yet.
   *
   * Not shorter, because every expiry costs a refresh round-trip, and a value
   * measured in seconds turns the refresh endpoint into the busiest route in
   * the admin panel.
   */
  ADMIN_ACCESS_TOKEN_TTL: z.coerce.number().int().positive().default(900),

  /**
   * Refresh-token lifetime in seconds. Thirty days — how long a staff member
   * stays signed in on a device they keep using. Enforced in the database
   * (`admin_sessions.expires_at`) as well as in the cookie, because a cookie
   * lifetime is a request the browser is free to ignore.
   */
  ADMIN_REFRESH_TOKEN_TTL: z.coerce.number().int().positive().default(2592000),

  /**
   * Consecutive failed logins before an account is locked, and for how long.
   *
   * This is a *per-account* control and the throttler is a per-IP one; they
   * catch different attacks and neither substitutes for the other. The
   * throttler stops one address grinding many passwords; this stops a
   * distributed attempt on one known address, where every request comes from a
   * different IP and no throttle bucket ever fills.
   *
   * Locking rather than escalating delay because there are a dozen accounts
   * and a real staff member who trips it can be unlocked by a colleague — and
   * a fifteen-minute wait is a support conversation, not an outage.
   */
  ADMIN_MAX_FAILED_LOGINS: z.coerce.number().int().positive().default(5),
  ADMIN_LOCKOUT_SECONDS: z.coerce.number().int().positive().default(900),

  /**
   * Whether session cookies carry `Secure`.
   *
   * Defaults to on outside development. Split from NODE_ENV rather than
   * derived from it because the failure is silent and confusing in both
   * directions: `Secure` on a plain-HTTP staging box means the browser accepts
   * the login response and then never sends the cookie back, which presents as
   * "login succeeds and then I am logged out" rather than as a cookie problem.
   */
  ADMIN_COOKIE_SECURE: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === true || value === "true")),

  /**
   * Domain for the session cookies. Unset means host-only, which is correct
   * when the admin panel is a route group in the Next.js app behind the same
   * origin as the API. Set it only for a genuinely separate admin host, and
   * note that a parent domain here shares the cookie with every subdomain.
   */
  ADMIN_COOKIE_DOMAIN: z.string().optional(),
});

/**
 * Cross-field rules the object schema cannot express.
 *
 * Kept as a refinement rather than as an `if` in `validateEnv`, so the failure
 * arrives in the same issue list as every other environment problem — an
 * operator fixing a bad `.env` should see all of it at once rather than
 * peeling off one error per restart.
 */
export const envSchemaChecked = envSchema.superRefine((env, ctx) => {
  if (env.NODE_ENV === "production" && !env.ADMIN_JWT_SECRET) {
    ctx.addIssue({
      code: "custom",
      path: ["ADMIN_JWT_SECRET"],
      message:
        "Required in production. Generate one with `openssl rand -base64 32`. " +
        "Without it the API would sign admin sessions with a key that changes " +
        "every restart, logging staff out on each deploy.",
    });
  }
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchemaChecked.safeParse(raw);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }

  return parsed.data;
}
