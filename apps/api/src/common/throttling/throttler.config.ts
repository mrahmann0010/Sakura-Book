import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";
import { seconds, type ThrottlerModuleOptions, type ThrottlerStorage } from "@nestjs/throttler";
import Redis from "ioredis";

/**
 * Rate limits, applied globally with tight per-route overrides.
 *
 * Three endpoints are worth limiting and the rest are not (§3.14). The
 * distinction is not "expensive" — the catalog is dozens of rows and is
 * cached at the edge — it is *what an attacker learns by repeating the call*:
 *
 * - **Coupon validation** answers "is this a real code?", so an unlimited one
 *   enumerates the shop's discounts.
 * - **Order lookup** answers "is this a real order number?" for a guessable
 *   eight-character space, and returning NOT_FOUND for a wrong email only
 *   closes that oracle if guessing is slow.
 * - **Order creation** writes rows and holds stock.
 *
 * The named buckets are defined here and referenced by `@StrictThrottle` on
 * the routes, so the numbers live in one file instead of being scattered
 * across decorators where nobody can compare them.
 */
/**
 * One bucket, globally, overridden per route.
 *
 * The obvious-looking alternative — configuring a second named "strict"
 * throttler alongside the default — is wrong, and silently so: ThrottlerGuard
 * applies *every* configured throttler to *every* route, so a strict bucket
 * defined here would rate-limit the catalog at 10 requests a minute whether or
 * not any decorator mentioned it. Verified by hitting `GET /books` thirteen
 * times and getting three 429s. The named bucket only earns its keep if some
 * routes genuinely need two independent windows, and none here do.
 */
export const THROTTLE_DEFAULT = "default";

/**
 * The tight limit, applied by `@StrictThrottle` on the three abusable routes.
 * Ten attempts a minute is well above what a customer typing an order number
 * does, and far below what enumeration needs.
 */
export const STRICT_LIMIT = { limit: 10, ttl: seconds(60) };

/**
 * Redis-backed counters when a URL is configured, in-memory otherwise.
 *
 * The fallback is a real degradation, not an equivalent: with per-instance
 * counters, two API pods give an attacker two buckets, and the limits above
 * exist specifically to make enumeration slow. It is still the right default
 * for local development, where standing up Redis to run the test suite would
 * be friction for no protection — and main.ts warns at boot when the URL is
 * missing anywhere else.
 */
function storageFor(redisUrl?: string): ThrottlerStorage | undefined {
  if (!redisUrl) return undefined;

  // `lazyConnect` so a Redis that is briefly unreachable does not take the
  // boot with it; ioredis retries in the background and the throttler degrades
  // to allowing requests rather than rejecting them.
  return new ThrottlerStorageRedisService(new Redis(redisUrl, { lazyConnect: true }));
}

export function throttlerConfig(redisUrl?: string): ThrottlerModuleOptions {
  return {
    storage: storageFor(redisUrl),
    throttlers: [
      {
        name: THROTTLE_DEFAULT,
        // Generous: this exists to stop a runaway client or a crawler, not to
        // ration normal browsing. A customer paging the catalog with filters
        // must never see a 429.
        ttl: seconds(60),
        limit: 300,
      },
    ],
    /**
     * Health checks are exempt. A probe hitting the limit would make the
     * orchestrator conclude the app is unhealthy and restart it — a rate limit
     * that causes an outage is worse than no rate limit.
     */
    skipIf: (context) => {
      const request = context.switchToHttp().getRequest<{ url?: string }>();

      return request.url?.includes("/health") ?? false;
    },
  };
}
