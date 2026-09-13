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
   *
   * `disable` is correct for container-to-container traffic on a private Docker
   * network, which never leaves the host — that is what production uses now.
   * The thing to keep true is the premise: if the database is ever reachable on
   * a published port, or the API and Postgres stop sharing a host, this has to
   * go back to `require` and the certificates become a real problem to solve.
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
   *
   * A self-hosted Postgres reached directly is exactly that case, so production
   * sets this to `true`. The default stays `false` because it is the setting
   * that is merely slower when wrong, rather than the one that fails
   * intermittently under load.
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
   * payment methods. The `£` in the placeholder catalog is a leftover to be
   * corrected, not a second currency — as was the "posted from Bristol"
   * footer copy, now replaced by the translated shop description.
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
   * ৳100 — the shop's rate, no longer the ৳60 courier estimate this defaulted
   * to. Note that a single flat rate cannot express the usual inside/outside-
   * Dhaka split; if that split is needed it becomes a per-region rate on the
   * regions table rather than a bigger number here.
   */
  DELIVERY_FLAT_CENTS: z.coerce.number().int().nonnegative().default(10000),

  /**
   * Subtotal in minor units at or above which postage is waived. ৳4,000 — a
   * marketing lever, and the one figure here most likely to move, which is why
   * Settings → Shipping exists: an operator moves it there without a deploy,
   * and this default stops applying to that field the moment they do.
   */
  FREE_DELIVERY_THRESHOLD_CENTS: z.coerce.number().int().nonnegative().default(400000),

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
   * Fallbacks for `shop_settings.{bkash,rocket,nagad}_number` — the numbers
   * shown at checkout for manual mobile-money transfers, until staff save an
   * override from Payment Settings. Server-side only (not `NEXT_PUBLIC_*`):
   * the frontend now reads these from the API, not the browser bundle, which
   * is what makes them admin-editable without a redeploy.
   */
  BKASH_NUMBER: z.string().trim().min(1).default("01700000000"),
  ROCKET_NUMBER: z.string().trim().min(1).default("01700000000"),
  NAGAD_NUMBER: z.string().trim().min(1).default("01700000000"),

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
   * Salt for the SHA-256 that `initial_reviews.ip_hash` stores instead of an
   * address.
   *
   * Optional, and its absence stores null rather than falling back to an
   * unsalted hash. That distinction matters: the IPv4 space is small enough to
   * enumerate in seconds, so an unsalted digest is the address with extra
   * steps, and the column would then be PII while looking as though it were
   * not. Losing the "same submitter" signal is the cheaper failure.
   *
   * Rotating it is safe and forgets the association — old hashes simply stop
   * matching new ones, which is the correct behaviour for a spam signal.
   */
  REVIEW_IP_SALT: z.string().min(16).optional(),

  /**
   * Connection string for the MongoDB the SMS payment gateway writes into —
   * the `bkash` / `nagad` / `rocket` collections a forwarded payment SMS is
   * parsed into. Read-only from this API's point of view; that service owns
   * the data and the `trxId` unique index that makes it idempotent.
   *
   * The database name comes from the URI's path rather than a second variable,
   * matching how the gateway's own backend resolves it (`get_default_database`
   * / `client.db()` with no argument). One string to copy between deployments,
   * and no way for the two halves to disagree about which database they mean.
   *
   * Optional, and its absence is a *degraded* door rather than an open or a
   * closed one: with no URI configured every cross-check returns UNAVAILABLE,
   * which leaves pre-orders PENDING for a human to verify by hand — exactly
   * the process that existed before this feature. It must never be read as
   * "no gateway configured, so assume the payment is good", which is why
   * PaymentVerificationService returns a verdict rather than a boolean.
   */
  MONGO_URI: z.string().url().optional(),

  /**
   * Maximum Postgres connections held by one API instance.
   *
   * postgres-js defaults to 10. Explicit because the number that matters is
   * per-instance × instances, and that product has to fit inside the database's
   * own budget with room to spare.
   *
   * Against a self-hosted Postgres in the same Docker network, the budget is
   * `max_connections` (100 by default on the official image) minus the
   * `superuser_reserved_connections` held back for an operator to get in with,
   * minus whatever else connects — a backup job, drizzle-kit during a deploy,
   * a psql session. 20 per instance is comfortable there; it was 10 on
   * Supabase because the limit was the pooler's client slots rather than the
   * database's connections, and a small project's pooler allowed far fewer
   * clients than the database would.
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
   * Access-token lifetime in seconds. One hour.
   *
   * Short because the token is a bearer credential the server does not consult
   * a table for — its lifetime is the window in which a stolen one keeps
   * working. It is not the *whole* revocation story: `admin_users.sessions_valid_from`
   * invalidates outstanding tokens immediately, and this bounds the damage
   * from a leak nobody has noticed yet.
   *
   * Was fifteen minutes, which cost four refreshes an hour per open tab. Each
   * refresh rotates the token, and a rotation is the only moment at which two
   * tabs can collide, so the shorter value was buying a narrower leak window
   * by making the one operation that can end a session run four times as
   * often. An hour is still far inside `sessions_valid_from`'s reach.
   */
  ADMIN_ACCESS_TOKEN_TTL: z.coerce.number().int().positive().default(3600),

  /**
   * Refresh-token lifetime in seconds. Ninety days — how long a staff member
   * stays signed in on a device they keep using. Enforced in the database
   * (`admin_sessions.expires_at`) as well as in the cookie, because a cookie
   * lifetime is a request the browser is free to ignore.
   *
   * The window is *rolling*: every refresh mints a successor with a fresh
   * ninety days, so a device in daily use never reaches the end of it. This
   * number is therefore how long a device may sit untouched before its owner
   * has to type a password again — the shop counter after a holiday, a phone
   * that was not the one being used — and not a cap on a working session.
   */
  ADMIN_REFRESH_TOKEN_TTL: z.coerce.number().int().positive().default(7776000),

  /**
   * How long after a refresh token is spent a *second* presentation of it is
   * still read as a race rather than as theft, in seconds.
   *
   * Rotation means a spent token presented again is evidence of a copy, and
   * the response is to revoke the whole session family — see
   * `AdminAuthService.refresh`. That is right for a replay hours later and
   * wrong for the one that actually happens: two admin tabs, or a tab and a
   * reload, reaching the refresh route within the same second. Both hold the
   * same cookie legitimately, the second arrives just after the first spent
   * it, and the session dies mid-task with nothing on screen to explain it.
   *
   * Thirty seconds covers the overlap a browser can produce and is far below
   * the timescale of a stolen token being carried somewhere and used.
   */
  ADMIN_REFRESH_REUSE_LEEWAY: z.coerce.number().int().nonnegative().default(30),

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

  /**
   * The self-hosted Garage cluster the admin panel's cover images and sample
   * PDFs are uploaded to — S3-compatible, and reached over its S3 API.
   *
   * These names, and the three switches below them, are deliberately the same
   * ones the Nihonova academy app's backend reads, because both apps write
   * into the *same bucket* and the values are therefore identical. One
   * configuration copied verbatim between two `.env` files, rather than two
   * spellings of it that drift apart.
   *
   * All optional, and their absence is a closed door rather than an open one:
   * StorageService throws StorageNotConfiguredError naming whichever are
   * missing, rather than silently writing nowhere. Everything else — login,
   * the dashboard, book CRUD with a manually-typed cover URL — works without
   * them; only the upload buttons need them.
   *
   * The secret key is a write credential for a bucket shared with another
   * application, which is why it lives only in this API process and is never
   * sent to the browser. The web app is given S3_PUBLIC_BASE_URL and nothing
   * else, that one being public by definition.
   */
  S3_ENDPOINT_URL: z.string().url().optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_BUCKET: z.string().min(1).optional(),

  /**
   * The Cloudflare-fronted domain published in front of the bucket: where
   * visitors read objects from, and the base of every URL stored in
   * `books.cover_image_url` and `books.pdf_url`.
   *
   * Never the S3 endpoint above. That one expects a signature on every
   * request, has no edge cache in front of it, and naming it in a page hands
   * every visitor the origin's address.
   */
  S3_PUBLIC_BASE_URL: z.string().url().optional(),

  /**
   * The region named in the signature's credential scope.
   *
   * Not the formality it is on R2, where any value is accepted: Garage
   * compares it against its own `s3_region` setting and rejects a mismatch, so
   * this has to be whatever that cluster was configured with — the same value
   * the other app sends. `garage` is that project's own default.
   */
  S3_REGION: z.string().min(1).default("garage"),

  /**
   * Path-style addressing (`<endpoint>/<bucket>/<key>`) rather than
   * virtual-hosted (`<bucket>.<endpoint>/<key>`).
   *
   * On by default, because it is the style that always works against a
   * self-hosted cluster: virtual-hosted addressing needs Garage's
   * `root_domain` set and a wildcard DNS record to match it. Turn it off for
   * R2 or AWS.
   */
  S3_USE_PATH_STYLE: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .default(true)
    .transform((value) => value === true || value === "true"),

  /**
   * Whether the bucket name appears in the *public* URL.
   *
   * Independent of the addressing style above, and the pair that is easiest to
   * get wrong together: Garage's web endpoint resolves the bucket from the
   * Host header via a domain alias, so its public URLs are `<base>/<key>` and
   * this is false — while that same deployment still uses path-style
   * addressing for the S3 API. Set it true for MinIO or R2 path-style public
   * reads, where the bucket is part of the path.
   */
  S3_PUBLIC_INCLUDE_BUCKET: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .default(false)
    .transform((value) => value === true || value === "true"),

  /**
   * Brevo (formerly Sendinblue) transactional API key.
   *
   * Optional, and its absence is a closed door rather than an open one, same
   * shape as PAYMENTS_WEBHOOK_SECRET: with no key configured, EmailService logs
   * and skips instead of sending. An order confirming is never allowed to fail
   * because a marketing tool is unreachable, so this must never be "silently
   * pretend it sent".
   */
  EMAIL_SERVICE: z.string().min(1).optional(),

  /**
   * The address transactional email is sent from. Must be a sender Brevo has
   * verified for this account — an unverified `from` is rejected by their API,
   * not silently delivered. Only meaningful alongside EMAIL_SERVICE.
   */
  EMAIL_FROM_ADDRESS: z.string().email().optional(),

  /** Display name on the `from` header. */
  EMAIL_FROM_NAME: z.string().trim().min(1).default("Nihonova Books"),

  /**
   * Base URL of the Android SMS Gateway app (capcom6/android-sms-gateway)
   * relaying texts through a phone — e.g. `http://<phone-ip>:8080/api/mobile/v1`
   * for local mode, or `https://api.sms-gate.app/3rdparty/v1` for the hosted
   * cloud relay. SmsService appends `/message` to this.
   *
   * Optional, same shape as EMAIL_SERVICE: unset means SmsService throws
   * SmsNotConfiguredError rather than silently pretending it sent.
   */
  SMS_GATEWAY_URL: z.string().url().optional(),

  /** HTTP Basic Auth username for the gateway above. Only meaningful alongside SMS_GATEWAY_URL. */
  SMS_GATEWAY_USERNAME: z.string().min(1).optional(),

  /** HTTP Basic Auth password for the gateway above. Only meaningful alongside SMS_GATEWAY_URL. */
  SMS_GATEWAY_PASSWORD: z.string().min(1).optional(),

  /**
   * How long a single gateway call may take before it is abandoned.
   *
   * `fetch` has no timeout of its own, and the thing on the other end is a
   * phone: it sleeps, loses signal, and gets picked up mid-send. Without a
   * bound, one unlucky call does not merely fail — it stops the clock, and
   * every recipient queued behind it is never attempted while the browser
   * waits for a response that will not come.
   *
   * Five seconds is a "something is wrong" threshold, not a normal-operation
   * one: a healthy send through the gateway phone answers in well under a
   * second, so anything approaching this is a phone that is asleep, off the
   * network, or has the app killed — and the useful response to that is to
   * fail fast, tell staff, and let them retry once the phone is awake. It is
   * also short enough that a worst-case batch (every send timing out, five in
   * flight) stays far inside any proxy's own cutoff.
   */
  SMS_GATEWAY_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(5_000),

  /**
   * The store name written into every row of the Pathao bulk-order CSV.
   *
   * Configurable rather than a constant in the exporter because it is a fact
   * about someone else's system: it must match the store registered on the
   * shop's Pathao merchant account exactly, and their importer rejects the
   * whole file when it does not. A default that needs no `.env` to work, and
   * an override for the day the account is renamed or a second store is added
   * — neither of which should need a deploy.
   */
  PATHAO_STORE_NAME: z.string().trim().min(1).default("Nihonova Academy"),
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
