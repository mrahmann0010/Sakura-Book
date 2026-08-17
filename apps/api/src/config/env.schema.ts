import { z } from "zod";

/**
 * Every environment variable the API depends on, validated once at boot.
 * A missing or malformed var fails startup here rather than surfacing as a
 * mystery `undefined` deep in a request handler.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().url(),

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
