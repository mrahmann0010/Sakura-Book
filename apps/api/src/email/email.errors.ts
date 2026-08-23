import { HttpStatus } from "@nestjs/common";
import { DomainError } from "../common/errors";

/**
 * EMAIL_SERVICE or EMAIL_FROM_ADDRESS is unset.
 *
 * Same shape as StorageNotConfiguredError: a closed door, not a silent no-op.
 * Callers that treat email as best-effort (the order-confirmation listener)
 * catch this and log rather than letting it surface.
 */
export class EmailNotConfiguredError extends DomainError {
  readonly code = "EMAIL_NOT_CONFIGURED";
  readonly status = HttpStatus.SERVICE_UNAVAILABLE;

  constructor() {
    super("Email is not configured — set EMAIL_SERVICE and EMAIL_FROM_ADDRESS.");
  }
}

/** Brevo's API rejected the send — bad key, unverified sender, malformed payload, etc. */
export class EmailSendFailedError extends DomainError {
  readonly code = "EMAIL_SEND_FAILED";
  readonly status = HttpStatus.BAD_GATEWAY;

  constructor(status: number, body: string) {
    super(`Email send failed (${status}): ${body.slice(0, 500)}`);
  }
}
