import { z } from "zod";

/* --------------------------------------------------------------------------
   Admin authentication.

   The storefront has no accounts and never will — guest checkout is the
   product (§3.13). Everything in this file is for the handful of staff who
   run the shop, and it is the only part of the API behind a credential.
   -------------------------------------------------------------------------- */

/**
 * Two roles, and deliberately not a permission matrix.
 *
 * `STAFF` is the daily fulfilment job: read orders, move them through the
 * status machine, adjust stock, moderate reviews. `ADMIN` is that plus the
 * things that change what the shop *sells* or *charges* — catalog, prices,
 * coupons, delivery rates, and the admin users themselves.
 *
 * The split is drawn at "can this person change what a customer pays?", which
 * is the only boundary the shop actually has today. A finer-grained
 * permissions table can be added the day someone needs a role that does not
 * fall on one side of it; adding one now would be a table nobody queries with
 * a UI nobody fills in.
 */
export const ADMIN_ROLES = ["STAFF", "ADMIN"] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export const adminRoleSchema = z.enum(ADMIN_ROLES);

/**
 * Minimum password length.
 *
 * Twelve rather than eight, and no composition rules (no "one uppercase, one
 * symbol"). Length is the only requirement that reliably buys entropy;
 * composition rules push people towards `Password1!` and a sticky note. This
 * is a set of staff accounts in the double digits, so the realistic threat is
 * credential stuffing, which is answered by the login throttle and by hashing
 * — not by punctuation.
 */
export const MIN_PASSWORD_LENGTH = 12;

export const adminPasswordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  // Bounded so a megabyte of text cannot be handed to a deliberately slow KDF;
  // an unbounded password field is a free CPU-exhaustion endpoint.
  .max(256, "Passwords must be at most 256 characters.");

export const adminLoginRequestSchema = z.object({
  // Lowercased here rather than at the database, so the client and the server
  // agree on what "the same address" means before it is ever looked up.
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export type AdminLoginRequest = z.infer<typeof adminLoginRequestSchema>;

/**
 * The signed-in admin, as the client is allowed to see them.
 *
 * Note what is absent: the password hash, obviously, but also the failed-login
 * counter and the lockout timestamp. Those are inputs to a decision the server
 * makes and telling the client about them turns the login form into a probe
 * for which accounts exist.
 */
export const adminUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: adminRoleSchema,
  lastLoginAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export type AdminUser = z.infer<typeof adminUserSchema>;

/**
 * What `/admin/auth/login`, `/admin/auth/refresh` and `/admin/auth/me` return.
 *
 * There is no token in this body, and that is the point: both tokens travel as
 * httpOnly cookies the browser attaches automatically and no script can read.
 * A body containing an access token would have to be stored by the client, and
 * every place a browser can store one is readable by any XSS on the page.
 *
 * `expiresAt` is here anyway, because the client still needs to know *when* to
 * call refresh without being able to read the token's own `exp`. It is
 * advisory — the server checks the token regardless.
 */
export const adminSessionSchema = z.object({
  user: adminUserSchema,
  /** When the current access token stops being accepted. ISO-8601. */
  expiresAt: z.string().datetime(),
});

export type AdminSession = z.infer<typeof adminSessionSchema>;

/**
 * Cookie names, shared so the web app's middleware can check for a session's
 * presence before rendering an admin route rather than firing a request that
 * it already knows will 401.
 *
 * Presence only — the cookies are httpOnly, so the middleware can see *that*
 * they exist and nothing more. Any real decision is still the API's.
 */
export const ADMIN_ACCESS_COOKIE = "sakura_admin_access";
export const ADMIN_REFRESH_COOKIE = "sakura_admin_refresh";
