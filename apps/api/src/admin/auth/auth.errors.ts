import { HttpStatus } from "@nestjs/common";
import { DomainError, ForbiddenError, UnauthorizedError } from "../../common/errors/domain.error";

/**
 * The refusals the auth module raises.
 *
 * Note how little each one says. Everywhere else in this codebase an error
 * carries rich `details` so the client can render a precise message — a coupon
 * says how much more you must spend, a bad transition names the statuses that
 * were allowed. Here the opposite rule applies: every extra fact is a fact an
 * attacker did not have to guess, and the client has nothing useful to do with
 * it anyway. There is one honest message on a login form and it is "those
 * details are not right".
 */

/**
 * Wrong email, wrong password, disabled account, or no such account — all one
 * error, deliberately.
 *
 * Distinguishing them is the classic account-enumeration hole: a form that
 * says "no account with that email" for one address and "wrong password" for
 * another has just confirmed which of the shop's staff addresses are real, and
 * a "your account is disabled" message tells a former employee their guess of
 * the password was correct. Same code, same status, and — see
 * AdminAuthService.login — the same amount of time.
 */
export class InvalidCredentialsError extends UnauthorizedError {
  readonly code = "INVALID_CREDENTIALS";

  constructor() {
    super("Invalid email or password");
  }
}

/**
 * Too many consecutive failures on this account.
 *
 * This one *does* distinguish itself, which looks like it contradicts the
 * paragraph above and does not: it is only ever raised after the credentials
 * were already checked and found wrong, so it confirms nothing that
 * InvalidCredentialsError has not already denied. Telling a locked-out staff
 * member to come back in fifteen minutes — rather than letting them retry a
 * correct password and still be refused — is the difference between a form
 * that is strict and a form that looks broken.
 *
 * `retryAfterSeconds` travels in details for the countdown; 423 Locked rather
 * than 429, because the limit is on the account, not on the caller's rate.
 */
export class AccountLockedError extends DomainError {
  readonly code = "ACCOUNT_LOCKED";
  /* Extends DomainError directly rather than BusinessRuleError, because the
     status is the whole point of this error and re-declaring an initialised
     property from a base class is a footgun under `useDefineForClassFields`:
     the base assigns 422, the subclass assigns 423, and which one survives
     depends on a compiler flag. The abstract base exists for exactly this. */
  readonly status = HttpStatus.LOCKED;

  constructor(retryAfterSeconds: number) {
    super("Account temporarily locked after repeated failed sign-ins", { retryAfterSeconds });
  }
}

/**
 * The refresh token was absent, expired, unknown, or already spent.
 *
 * One error for all four for the usual reason, plus a practical one: the
 * client's response to every case is identical — send the user back to the
 * login form. A taxonomy here would be detail nobody branches on.
 */
export class SessionExpiredError extends UnauthorizedError {
  readonly code = "SESSION_EXPIRED";

  constructor() {
    super("Session expired — sign in again");
  }
}

/**
 * Authenticated, but the role is not sufficient.
 *
 * Unlike the errors above this one names what was required, because by this
 * point the caller is a known, signed-in member of staff: there is no
 * enumeration risk in telling a STAFF user that a route needs ADMIN, and
 * without it the panel can only show them a dead end.
 */
export class InsufficientRoleError extends ForbiddenError {
  readonly code = "NOT_AUTHORIZED";

  constructor(required: readonly string[], actual: string) {
    super(`This action requires one of: ${required.join(", ")}`, { required, actual });
  }
}
