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
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }

  return parsed.data;
}
