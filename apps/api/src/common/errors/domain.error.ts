import { HttpStatus } from "@nestjs/common";

/**
 * The errors the domain is allowed to throw.
 *
 * Services must never throw NestJS's HTTP exceptions (ConflictException,
 * NotFoundException, ...). Doing so makes business logic depend on the
 * transport it happens to be exposed over today: the same checkout code has to
 * run from a seed script, a queue consumer and a test, and "409 Conflict"
 * means nothing in any of those. Services throw these; the global filter is
 * the single place that decides what they look like over HTTP.
 *
 * `code` is the part clients are allowed to depend on. It is a public API:
 * renaming one is a breaking change, so treat the set of codes as deliberately
 * as the endpoint list. `message` is for developers and logs — never render it
 * to a user. Anything a message needs to say ("spend 500 more") travels as
 * structured `details` so the caller can format and translate it itself.
 */
export abstract class DomainError extends Error {
  /** Stable machine-readable identifier, SCREAMING_SNAKE_CASE. */
  abstract readonly code: string;

  /** HTTP status the filter maps this to. */
  abstract readonly status: HttpStatus;

  /** Structured parameters for the caller's own message rendering. */
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    // Without this, every subclass reports `name` as "Error" in logs, because
    // Error's constructor sets it from Error.prototype rather than the subclass.
    this.name = new.target.name;
    this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
}

/**
 * The requested thing does not exist — or must be indistinguishable from not
 * existing. Order lookup deliberately raises this rather than a 403 when the
 * email doesn't match the order: a "wrong email" response would confirm the
 * order ID is real, turning the endpoint into an oracle for anyone guessing.
 */
export abstract class NotFoundError extends DomainError {
  readonly status = HttpStatus.NOT_FOUND;
}

/**
 * Understood, well-formed, and refused because it violates a business rule:
 * a cart under a coupon's minimum, a cancellation of an order already shipped.
 *
 * 422 rather than 400 on purpose. 400 means "this request was malformed and
 * the client should fix its code"; 422 means "the request was fine and the
 * answer is no". The validation pipe owns 400; the domain owns 422. Keeping
 * them apart is what lets a client distinguish its own bug from a rule.
 */
export abstract class BusinessRuleError extends DomainError {
  readonly status = HttpStatus.UNPROCESSABLE_ENTITY;
}

/**
 * The request raced another one and lost, or state moved underneath it: stock
 * taken by a concurrent checkout, a coupon exhausted between validation and
 * redemption, an order transitioned by an admin mid-request.
 *
 * The distinction from BusinessRuleError is whether retrying could ever help.
 * A conflict is transient — the same request may well succeed a moment later,
 * so clients may surface a retry. A rule violation will fail identically
 * forever until the input changes.
 */
export abstract class ConflictError extends DomainError {
  readonly status = HttpStatus.CONFLICT;
}

/** Missing or invalid credentials. */
export abstract class UnauthorizedError extends DomainError {
  readonly status = HttpStatus.UNAUTHORIZED;
}

/** Authenticated, but not allowed to do this. */
export abstract class ForbiddenError extends DomainError {
  readonly status = HttpStatus.FORBIDDEN;
}
