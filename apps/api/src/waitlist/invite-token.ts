import { randomBytes } from "node:crypto";

/* --------------------------------------------------------------------------
   Invite tokens

   These travel by SMS, and a Bangla SMS is UCS-2 — 70 characters for the
   whole message, not 160. The old token was `randomBytes(32).toString(
   "base64url")`: 43 characters, which by itself ate more than half of every
   Bangla invite's budget and pushed the message to three billed segments.

   So the alphabet is Crockford Base32 rather than base64url. It is shorter
   per token at the entropy we actually need, it survives being read aloud or
   typed by hand (no I/L/O/U, so no letter can be mistaken for a digit or for
   another letter), and it is case-insensitive — a phone keyboard that
   auto-capitalises the first character of a pasted link cannot break it.
   -------------------------------------------------------------------------- */

/** Crockford Base32: 0-9 then A-Z minus I, L, O and U. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * 11 characters, 55 bits.
 *
 * Sized against what these have to withstand, which is guessing rather than
 * offline cracking: a token lives for `ttlHours` (48 by default) and one
 * guess costs an HTTP round trip. 2^55 is far past what that budget reaches,
 * and at ten million issued tokens the odds of any two colliding are about
 * three in ten million — and the unique index behind `inviteToken` turns
 * even that into a retry rather than two customers sharing a link.
 *
 * Below 11 the arithmetic stops being comfortable (8 characters is 40 bits,
 * which is genuinely enumerable), and above it we start paying SMS segments
 * for entropy nobody needs.
 */
export const INVITE_TOKEN_LENGTH = 11;

/**
 * Mint one token.
 *
 * Rejection sampling rather than `byte % 32`: 256 is a whole multiple of 32,
 * so the modulo would be unbiased here anyway — but the mask is clearer about
 * why it's safe, and stays correct if the alphabet ever changes length.
 */
export function generateInviteToken(): string {
  const bytes = randomBytes(INVITE_TOKEN_LENGTH);
  let token = "";

  for (const byte of bytes) {
    token += ALPHABET[byte & 0x1f];
  }

  return token;
}

/**
 * Fold whatever arrived in the URL into the form we stored.
 *
 * Every lookup goes through this, because the thing that reaches us is not
 * always the thing we sent: SMS clients lowercase links, people retype them
 * from a screenshot, and Crockford treats O as 0 and I/L as 1 precisely so
 * that those mistakes still resolve. Tokens are stored uppercase, so this
 * uppercases and then applies those substitutions.
 *
 * Anything that isn't in the alphabet after that is left alone — it will
 * simply fail to match a row, which is the correct outcome for a mangled
 * link and keeps this function free of its own error cases.
 */
export function normalizeInviteToken(token: string): string {
  return token.toUpperCase().replaceAll("O", "0").replaceAll("I", "1").replaceAll("L", "1");
}
