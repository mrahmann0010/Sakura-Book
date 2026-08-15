import { ApiProperty } from "@nestjs/swagger";

/**
 * One field-level problem. Only present on validation failures.
 *
 * `path` is dotted and array-indexed the way the request body nests
 * ("items.0.quantity", "shippingAddress.postalCode") so a client can bind an
 * error straight to the input that produced it without parsing anything.
 */
export class FieldErrorDto {
  @ApiProperty({ example: "items.0.quantity" })
  path!: string;

  /** Zod's issue code ("too_small", "invalid_type") — branchable, translatable. */
  @ApiProperty({ example: "too_small" })
  code!: string;

  @ApiProperty({ example: "Number must be greater than or equal to 1" })
  message!: string;
}

export class ErrorBodyDto {
  /** Stable identifier. The only field a client should branch or translate on. */
  @ApiProperty({ example: "COUPON_EXPIRED" })
  code!: string;

  /**
   * Developer-facing. Written for whoever is reading logs at 2am, not for a
   * customer — the API ships one language and the clients ship three.
   */
  @ApiProperty({ example: "Coupon 'SPRING24' expired at 2026-03-01T00:00:00Z" })
  message!: string;

  /** Parameters for the client's own rendering, e.g. `{ minOrderCents: 500 }`. */
  @ApiProperty({ required: false, type: Object })
  details?: Record<string, unknown>;

  @ApiProperty({ required: false, type: [FieldErrorDto] })
  fields?: FieldErrorDto[];
}

/**
 * The single error envelope. Every non-2xx response from this API has exactly
 * this shape — domain failures, validation failures, unhandled crashes alike.
 *
 * Nested under `error` rather than spread at the top level so a client can
 * test one key to tell success from failure, without a 2xx payload ever being
 * able to collide with an error field.
 */
export class ErrorResponseDto {
  @ApiProperty({ type: ErrorBodyDto })
  error!: ErrorBodyDto;

  /**
   * Correlates this response with the server logs for the same request. Worth
   * putting in front of users on 5xx: "quote this id" turns an unreproducible
   * bug report into a log query.
   */
  @ApiProperty({ example: "b7c1f0e2-3a44-4f1e-9b2d-1c8f4a6e5d30" })
  requestId!: string;

  @ApiProperty({ example: "2026-08-15T09:41:00.000Z" })
  timestamp!: string;

  @ApiProperty({ example: "/api/v1/coupons/validate" })
  path!: string;
}
