import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { ZodError, type ZodIssue } from "zod";
import { DomainError } from "./domain.error";
import type { ErrorBodyDto, ErrorResponseDto, FieldErrorDto } from "./error-response";
import { isPostgresError, mapPostgresError } from "./postgres-error.mapper";

/**
 * The one place an exception becomes an HTTP response.
 *
 * Deliberately a single `@Catch()` that dispatches internally, rather than the
 * more conventional set of narrow filters (one for DomainError, one for
 * ZodError, ...). With several global filters registered, which one wins is a
 * function of registration order, and the failure mode is silent: a filter
 * quietly stops being reached and errors start coming out in the wrong shape.
 * One filter with an explicit `if` ladder makes the precedence readable and
 * removes the ordering question entirely.
 *
 * Every branch converges on the same envelope, so a client has exactly one
 * error shape to parse — including for crashes we never anticipated.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const { status, body } = this.toErrorBody(exception);

    const payload: ErrorResponseDto = {
      error: body,
      requestId: this.requestIdOf(request),
      timestamp: new Date().toISOString(),
      path: request.originalUrl ?? request.url,
    };

    this.log(exception, payload, status);
    response.status(status).json(payload);
  }

  private toErrorBody(exception: unknown): { status: HttpStatus; body: ErrorBodyDto } {
    // Ordered most specific first. Domain errors lead because they carry the
    // codes clients actually branch on.
    if (exception instanceof DomainError) {
      return {
        status: exception.status,
        body: { code: exception.code, message: exception.message, details: exception.details },
      };
    }

    if (exception instanceof ZodError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        body: {
          code: "VALIDATION_FAILED",
          message: "Request failed validation",
          fields: exception.issues.map(toFieldError),
        },
      };
    }

    if (isPostgresError(exception)) {
      const mapped = mapPostgresError(exception);
      if (mapped) {
        return {
          status: mapped.status,
          body: { code: mapped.code, message: mapped.message, details: mapped.details },
        };
      }
      // Unmapped driver error: a bug on our side, not the caller's. Fall
      // through to the opaque 500 rather than guessing at a 4xx.
      return { status: HttpStatus.INTERNAL_SERVER_ERROR, body: INTERNAL_ERROR_BODY };
    }

    // Nest's own throws (unmatched route, throttler, body-size limits) plus any
    // HttpException from library code. Re-shaped into our envelope so callers
    // never encounter Nest's default `{statusCode, message, error}` format.
    if (exception instanceof HttpException) {
      return { status: exception.getStatus(), body: fromHttpException(exception) };
    }

    return { status: HttpStatus.INTERNAL_SERVER_ERROR, body: INTERNAL_ERROR_BODY };
  }

  /**
   * 5xx means we're broken and someone must look — log the stack. 4xx is the
   * API working correctly (an expired coupon, a cart under a minimum) and
   * logging those at error level trains everyone to ignore the error log.
   */
  private log(exception: unknown, payload: ErrorResponseDto, status: HttpStatus): void {
    const line = `${payload.error.code} ${status} ${payload.path} [${payload.requestId}]`;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(line, exception instanceof Error ? exception.stack : String(exception));
    } else {
      this.logger.debug(`${line} — ${payload.error.message}`);
    }
  }

  /**
   * Prefers the id pino-http attaches, so a response and its request log line
   * carry the same value. Falls back to an inbound header (set by a proxy, and
   * the thing that makes an id traceable across services), then to a fresh one
   * so this field is never empty.
   */
  private requestIdOf(request: Request): string {
    const attached = (request as Request & { id?: unknown }).id;
    if (typeof attached === "string" || typeof attached === "number") return String(attached);

    const header = request.headers["x-request-id"];
    if (typeof header === "string" && header.length > 0) return header;

    return randomUUID();
  }
}

/**
 * Fixed and detail-free on purpose. An unhandled exception's message routinely
 * contains connection strings, SQL fragments or file paths, and this is the one
 * branch whose content we by definition haven't reviewed. The stack goes to the
 * logs; the client gets a requestId to quote.
 */
const INTERNAL_ERROR_BODY: ErrorBodyDto = {
  code: "INTERNAL_ERROR",
  message: "An unexpected error occurred",
};

function toFieldError(issue: ZodIssue): FieldErrorDto {
  return {
    // Array indices become path segments ("items.0.quantity") so the client can
    // address the exact input that failed, not just the collection.
    path: issue.path.join("."),
    code: issue.code,
    message: issue.message,
  };
}

function fromHttpException(exception: HttpException): ErrorBodyDto {
  const status = exception.getStatus();
  const response = exception.getResponse();

  // HttpStatus is a numeric enum, so reverse lookup yields the canonical name
  // ("NOT_FOUND", "TOO_MANY_REQUESTS") — the same SCREAMING_SNAKE shape as our
  // domain codes, which keeps clients on one parsing rule.
  const code = HttpStatus[status] ?? "HTTP_ERROR";

  const message =
    typeof response === "string"
      ? response
      : ((response as { message?: unknown }).message ?? exception.message);

  return {
    code: typeof code === "string" ? code : "HTTP_ERROR",
    message: Array.isArray(message) ? message.join("; ") : String(message),
  };
}
