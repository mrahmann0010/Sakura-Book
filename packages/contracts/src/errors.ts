import { z } from "zod";

/* --------------------------------------------------------------------------
   The error envelope, and the codes a client is allowed to branch on.

   This mirrors ErrorResponseDto in apps/api/src/common/errors/error-response.ts
   — deliberately, and it is the one duplication in this package that is not
   automatic. The API needs decorated classes for Swagger; the client needs a
   runtime validator. Keeping them in step is a review obligation, and the
   e2e suite asserting a real error response against `errorResponseSchema` is
   what turns that obligation into a test failure.
   -------------------------------------------------------------------------- */

/**
 * Codes the API raises deliberately. Each maps to a DomainError subclass, and
 * per domain.error.ts these are public API: renaming one is a breaking change.
 */
export const KNOWN_ERROR_CODES = [
  // common.errors.ts
  "NOT_FOUND",
  "INVALID_INPUT",
  "CONFLICT",
  "ALREADY_EXISTS",
  "NOT_AUTHENTICATED",
  "NOT_AUTHORIZED",
  // module-specific
  "COUPON_UNAVAILABLE",
  "OUT_OF_STOCK",
  "INVALID_STATUS_TRANSITION",
  // A pre-order cannot be fulfilled until its payment has been accepted — the
  // one rule that spans the two pre-order lifecycles.
  "PAYMENT_NOT_ACCEPTED",
  "INVALID_CREDENTIALS",
  "ACCOUNT_LOCKED",
  "ACCOUNT_DISABLED",
  "SESSION_EXPIRED",
  // filter-generated
  "VALIDATION_FAILED",
  "INTERNAL_ERROR",
] as const;

export type KnownErrorCode = (typeof KNOWN_ERROR_CODES)[number];

/**
 * `string & {}` keeps editor autocomplete for the known codes while still
 * accepting the ones the global filter synthesises from Nest's own throws —
 * `HttpStatus[status]` yields TOO_MANY_REQUESTS, PAYLOAD_TOO_LARGE and
 * friends, which are real responses this API can return but not ones any
 * service declares. A closed union here would be a lie that type-checks.
 */
export type ErrorCode = KnownErrorCode | (string & {});

export function isKnownErrorCode(code: string): code is KnownErrorCode {
  return (KNOWN_ERROR_CODES as readonly string[]).includes(code);
}

/** One field-level problem. `path` is dotted and array-indexed: `items.0.quantity`. */
export const fieldErrorSchema = z.object({
  path: z.string(),
  /** Zod's issue code (`too_small`, `invalid_type`) — branchable, translatable. */
  code: z.string(),
  /** Developer-facing English. Clients translate from `code` + `path`. */
  message: z.string(),
});

export const errorBodySchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
  fields: z.array(fieldErrorSchema).optional(),
});

export const errorResponseSchema = z.object({
  error: errorBodySchema,
  requestId: z.string(),
  timestamp: z.string(),
  path: z.string(),
});

export type FieldError = z.infer<typeof fieldErrorSchema>;
export type ErrorBody = z.infer<typeof errorBodySchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/**
 * Narrows an unknown rejection payload to the envelope.
 *
 * The client's fetch wrapper cannot assume a non-2xx body is even JSON — a
 * proxy timeout or a 502 from in front of the app returns HTML, and treating
 * that as an ErrorResponse produces `undefined` reads at the point of display.
 * Parse, don't cast.
 */
export function isErrorResponse(value: unknown): value is ErrorResponse {
  return errorResponseSchema.safeParse(value).success;
}

/** Reads the field errors as a path → message map, the shape a form wants. */
export function fieldErrorMap(response: ErrorResponse): Record<string, string> {
  return Object.fromEntries(
    (response.error.fields ?? []).map((field) => [field.path, field.message]),
  );
}
