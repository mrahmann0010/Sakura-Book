/* --------------------------------------------------------------------------
   The idempotency key an order's payment is claimed with at the gateway.

   `<orderNumber>:<attempt>`. The same key is sent on every retry of one
   attempt — a timeout, a 404 poll, a worker restart — so the gateway hands
   back our own earlier claim. A *new* key for the same payment collides with
   that claim and comes back `already_claimed`, which looks exactly like
   someone else taking the money.

   The attempt moves on only when the old key can no longer succeed: a gateway
   admin released the claim (RELEASED), or the order now carries a different
   transaction ID. Reopening a cancelled order keeps the key — if that order
   had claimed its payment, the claim is still ours, and the same key gets it
   back.
   -------------------------------------------------------------------------- */

const KEY_PATTERN = /^(.+):(\d+)$/;

/** The gateway's limit on idempotency keys. */
const MAX_KEY_LENGTH = 200;

export function firstClaimKey(orderNumber: string): string {
  return `${orderNumber}:1`;
}

/**
 * The key to claim with now. Orders placed before keys existed have none
 * stored, and get the first one.
 */
export function claimKeyFor(order: { orderNumber: string; paymentClaimKey: string | null }): string {
  return order.paymentClaimKey ?? firstClaimKey(order.orderNumber);
}

/** The key for the next attempt: `SB-10482:1` → `SB-10482:2`. */
export function nextClaimKey(orderNumber: string, current: string | null): string {
  const match = current ? KEY_PATTERN.exec(current) : null;
  const attempt = match && match[1] === orderNumber ? Number(match[2]) : 1;
  const next = `${orderNumber}:${attempt + 1}`;

  if (next.length > MAX_KEY_LENGTH) {
    throw new Error(`Claim key for ${orderNumber} would exceed ${MAX_KEY_LENGTH} characters.`);
  }

  return next;
}
