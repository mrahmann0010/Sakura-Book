/* --------------------------------------------------------------------------
   When to ask the gateway again.

   The customer usually clicks "I've paid" a few seconds before the payment
   SMS reaches the gateway, so the first claim at checkout is often
   `not_found`. That is normal. The worker retries quickly at first, then
   gives up and leaves the order for a person.

   An order staff have already confirmed with a reason (the SMS had not
   arrived) keeps being retried for longer, at a slower pace: the payment
   still needs to be marked spent at the gateway once it turns up, or another
   business sharing the number could claim it.
   -------------------------------------------------------------------------- */

/** 5s, 10s, 20s, then every 30s — about four minutes in all. */
export const FAST_RETRY_DELAYS_SECONDS = [5, 10, 20, 30, 30, 30, 30, 30, 30, 30] as const;

/** After the fast schedule, for orders already confirmed by staff. */
export const LATE_RETRY_INTERVAL_SECONDS = 10 * 60;

/** Eight hours of late retries. */
export const LATE_RETRY_ATTEMPTS = 48;

/**
 * Seconds until the next try, or null to stop.
 *
 * @param attempts claims made so far under the current key, including the
 *   one that just failed.
 * @param granted whether the order is already confirmed (by a staff override).
 * @param retryAfterSeconds the gateway's own "wait this long", on a rate limit.
 */
export function nextRetryDelaySeconds(
  attempts: number,
  granted: boolean,
  retryAfterSeconds?: number,
): number | null {
  let delay: number | null = null;

  if (attempts >= 1 && attempts <= FAST_RETRY_DELAYS_SECONDS.length) {
    delay = FAST_RETRY_DELAYS_SECONDS[attempts - 1];
  } else if (granted && attempts <= FAST_RETRY_DELAYS_SECONDS.length + LATE_RETRY_ATTEMPTS) {
    delay = LATE_RETRY_INTERVAL_SECONDS;
  }

  if (delay === null) return null;

  return retryAfterSeconds && retryAfterSeconds > delay ? Math.ceil(retryAfterSeconds) : delay;
}
