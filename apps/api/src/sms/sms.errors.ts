import { HttpStatus } from "@nestjs/common";
import { DomainError } from "../common/errors";

/**
 * SMS_GATEWAY_URL, SMS_GATEWAY_USERNAME, or SMS_GATEWAY_PASSWORD is unset.
 *
 * Same shape as EmailNotConfiguredError: a closed door, not a silent no-op.
 * Callers that treat SMS as best-effort catch this and log rather than
 * letting it surface.
 */
export class SmsNotConfiguredError extends DomainError {
  readonly code = "SMS_NOT_CONFIGURED";
  readonly status = HttpStatus.SERVICE_UNAVAILABLE;

  constructor() {
    super(
      "SMS is not configured — set SMS_GATEWAY_URL, SMS_GATEWAY_USERNAME, and SMS_GATEWAY_PASSWORD.",
    );
  }
}

/**
 * The gateway rejected the send or could not be reached — bad credentials, a
 * malformed payload, or the phone running the gateway app is off, offline, or
 * has the app killed.
 */
export class SmsSendFailedError extends DomainError {
  readonly code = "SMS_SEND_FAILED";
  readonly status = HttpStatus.BAD_GATEWAY;

  constructor(status: number, body: string) {
    super(`SMS send failed (${status}): ${body.slice(0, 500)}`);
  }
}
