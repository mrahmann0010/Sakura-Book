import { PostgresError } from "postgres";
import { DuplicateResourceError, InvalidInputError, ResourceConflictError } from "./common.errors";
import type { DomainError } from "./domain.error";

/**
 * Translates the database's own constraint failures into domain errors.
 *
 * The schema enforces real invariants — unique coupon codes, uppercase codes,
 * a discount value inside its type's legal range — and deliberately so: they
 * hold no matter which code path writes. But that means a violation can arrive
 * as a raw driver error from a service that never anticipated it, and without
 * this it would surface as a 500 with a Postgres string in the body.
 *
 * Only violations that a *caller* could have caused are mapped. Anything that
 * can only mean a bug on our side — a not-null violation, an undefined column
 * — is deliberately left alone so it becomes a 500 and gets noticed. Turning
 * our own bugs into tidy 4xx responses just hides them.
 *
 * @see https://www.postgresql.org/docs/current/errcodes-appendix.html
 */

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";
const EXCLUSION_VIOLATION = "23P01";
const SERIALIZATION_FAILURE = "40001";
const DEADLOCK_DETECTED = "40P01";

/**
 * The driver error inside whatever threw, or undefined if there isn't one.
 *
 * Not `instanceof PostgresError` on the thrown value, which is what this used
 * to be and what made every rule below unreachable in practice. Since drizzle
 * 0.44 every statement that fails is re-thrown as `DrizzleQueryError` with the
 * driver's error hung off `cause` — so the value a service catches, and the
 * value the global filter sees, is the wrapper. `instanceof` said no to all of
 * them, and the entire mapper was dead code: a unique violation came back as an
 * opaque 500 instead of a 409, and so did every constraint this schema has
 * spent five migrations adding.
 *
 * That is not a theoretical loss. It is why joining a waitlist answered 500
 * — the storefront's own copy of the constraint check can only ever be a
 * pre-check, and the database's answer was the half being thrown away.
 *
 * Walking `cause` rather than special-casing `DrizzleQueryError` keeps this
 * from breaking again the next time something wraps: `AggregateError`, a
 * transaction helper, a future drizzle. The depth cap is only there so a
 * self-referencing cause chain cannot hang the error path.
 */
export function toPostgresError(error: unknown): PostgresError | undefined {
  for (let current = error, depth = 0; depth < 5; depth += 1) {
    if (current instanceof PostgresError) return current;
    if (!(current instanceof Error) || current.cause === undefined) return undefined;

    current = current.cause;
  }

  return undefined;
}

/** True when a driver error is in there somewhere — see `toPostgresError`. */
export function isPostgresError(error: unknown): boolean {
  return toPostgresError(error) !== undefined;
}

/**
 * Constraint names are returned to the client inside the developer-facing
 * `message`. They aren't secrets — but if that ever becomes unwelcome, this is
 * the one function to redact in, rather than hunting through services.
 */
export function mapPostgresError(error: PostgresError): DomainError | undefined {
  const constraint = error.constraint_name;
  const table = error.table_name;

  switch (error.code) {
    case UNIQUE_VIOLATION:
      return new DuplicateResourceError(table ?? "Resource", constraint);

    case FOREIGN_KEY_VIOLATION:
      // The caller referenced a row that doesn't exist (or tried to delete one
      // still referenced). Their input is at fault, so 422 rather than 500.
      return new InvalidInputError(
        `Referenced record does not exist${constraint ? ` (${constraint})` : ""}`,
        { constraint, table },
      );

    case CHECK_VIOLATION:
      // Reachable from admin writes — e.g. a 150% PERCENTAGE coupon tripping
      // coupons_discount_value_valid. A rule violation, not a malformed request.
      return new InvalidInputError(
        `Value violates constraint${constraint ? ` '${constraint}'` : ""}`,
        { constraint, table },
      );

    case EXCLUSION_VIOLATION:
      return new ResourceConflictError(
        `Conflicts with an existing record${constraint ? ` (${constraint})` : ""}`,
        { constraint, table },
      );

    case SERIALIZATION_FAILURE:
    case DEADLOCK_DETECTED:
      // Postgres aborted this transaction to break a conflict with a
      // concurrent one. Nothing was wrong with the request and the identical
      // retry will usually succeed — which is exactly what 409 promises.
      return new ResourceConflictError(
        "The request conflicted with a concurrent operation. Please retry.",
        { retryable: true },
      );

    default:
      // Unmapped: let it reach the 500 path so it shows up in the logs.
      return undefined;
  }
}
