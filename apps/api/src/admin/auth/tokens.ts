import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { adminRoleSchema } from "@sakura/contracts";

/**
 * The two credentials, and the claims one of them carries.
 *
 * Refresh tokens are opaque random bytes — they mean nothing on their own and
 * are only useful as a lookup key into `admin_sessions`. Access tokens are
 * signed JWTs carrying just enough to authorise a request without a database
 * round-trip.
 */

/** 256 bits from the CSPRNG. base64url so it survives a cookie unescaped. */
export function mintRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The value stored in `admin_sessions.token_hash`.
 *
 * Plain SHA-256, not a slow KDF: the input is 32 random bytes, so there is no
 * dictionary to run and nothing that a work factor would protect. See the
 * column comment.
 */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/**
 * Access token claims.
 *
 * Validated on the way *out* of `jwt.verify` as well as on the way in, which
 * is not belt-and-braces theatre: a token signed by us six months ago with a
 * claim shape that has since changed will verify cryptographically and then be
 * read as `undefined` in a guard. Parsing the payload turns that into a clean
 * 401 rather than an authorisation decision made on a missing field.
 *
 * `sub` is the admin user id. `sid` is the refresh session that minted this
 * token, so revoking a single device also stops the access tokens it issued.
 * `iat` is standard and is the value compared against `sessions_valid_from`.
 */
export const accessClaimsSchema = z.object({
  sub: z.string().uuid(),
  sid: z.string().uuid(),
  role: adminRoleSchema,
  email: z.string(),
  /** Issued-at, seconds since epoch. Set by the signer, not by us. */
  iat: z.number().int(),
  exp: z.number().int(),
});

export type AccessClaims = z.infer<typeof accessClaimsSchema>;

/** The claims we supply; `iat` and `exp` are the signer's to add. */
export type AccessClaimsInput = Pick<AccessClaims, "sub" | "sid" | "role" | "email">;
