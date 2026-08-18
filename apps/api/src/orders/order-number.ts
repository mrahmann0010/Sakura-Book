import { randomInt } from "node:crypto";

/**
 * The customer-facing order id: `MG-40718`. Eight characters, as the
 * confirmation copy promises and `draftOrderId()` in the web app mocks.
 *
 * Random, not sequential, and that is a security property rather than a
 * cosmetic one. /orders/lookup authenticates by order number plus a matching
 * email; a sequential number would let anyone holding one order number
 * enumerate the neighbours and learn how many orders the shop takes a day.
 * Five digits is only ~90k values, which is thin — but the number alone opens
 * nothing without the email, and lengthening it later is a format change the
 * printed copy would have to follow, so it is deliberately matched to what the
 * UI already promises rather than chosen for entropy.
 *
 * `randomInt` from node:crypto rather than Math.random: the whole point is
 * unpredictability, and Math.random's output is a documented non-guarantee.
 */
export const ORDER_NUMBER_PREFIX = "MG";

export function generateOrderNumber(): string {
  return `${ORDER_NUMBER_PREFIX}-${randomInt(10000, 100000)}`;
}

/**
 * How many times to re-roll after a collision before giving up.
 *
 * Collisions are the birthday problem against a 90k space, so they are rare
 * but not negligible once the shop has thousands of orders — which is exactly
 * why insertion retries on the unique violation rather than checking for
 * existence first. A SELECT-then-INSERT would be a race with the same shape as
 * every other one in this codebase; the unique index is the only check that
 * actually holds.
 *
 * Three attempts is not a reliability limit, it is a bug detector: if three
 * independent draws all collide, the problem is not luck, and looping forever
 * would hide it as latency.
 */
export const ORDER_NUMBER_ATTEMPTS = 3;
