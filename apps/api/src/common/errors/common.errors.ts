import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from "./domain.error";

/**
 * Errors that aren't specific to any one module. Domain-specific errors live
 * with their module (coupons/coupon.errors.ts, orders/order.errors.ts) so the
 * rules and the failures they produce stay in one place.
 */

/**
 * Something addressed by id/slug wasn't found.
 *
 * `resource` is carried in details rather than baked into the code, so clients
 * branch on one NOT_FOUND rather than a code per table, and the message stays
 * translatable from a single key.
 */
export class ResourceNotFoundError extends NotFoundError {
  readonly code = "NOT_FOUND";

  constructor(resource: string, identifier?: string) {
    super(
      identifier ? `${resource} '${identifier}' not found` : `${resource} not found`,
      { resource, identifier },
    );
  }
}

/**
 * Input was well-formed but failed a check the schema couldn't express — a
 * cross-field rule, or one needing a database lookup (an unknown category
 * slug in a filter). Purely structural failures are the pipe's job, not this.
 */
export class InvalidInputError extends BusinessRuleError {
  readonly code = "INVALID_INPUT";

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
  }
}

/**
 * Two writers raced for the same row and this one lost.
 *
 * Raised from guarded updates — the `UPDATE ... WHERE still_available` pattern
 * — where matching zero rows is how the database tells us it serialised the
 * two attempts and picked the other one. Safe for the client to retry.
 */
export class ResourceConflictError extends ConflictError {
  readonly code = "CONFLICT";

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
  }
}

/**
 * A uniqueness guarantee was violated — raised by the Postgres error mapper on
 * 23505 rather than thrown by hand, so a constraint added in a migration
 * surfaces as a clean 409 even if no service knows about it yet.
 */
export class DuplicateResourceError extends ConflictError {
  readonly code = "ALREADY_EXISTS";

  constructor(resource: string, constraint?: string) {
    super(`${resource} already exists`, { resource, constraint });
  }
}

/** Credentials absent, malformed, or expired. */
export class NotAuthenticatedError extends UnauthorizedError {
  readonly code = "NOT_AUTHENTICATED";

  constructor(message = "Authentication required") {
    super(message);
  }
}

/** Authenticated, but lacking the rights for this action. */
export class NotAuthorizedError extends ForbiddenError {
  readonly code = "NOT_AUTHORIZED";

  constructor(message = "Not permitted", details?: Record<string, unknown>) {
    super(message, details);
  }
}
