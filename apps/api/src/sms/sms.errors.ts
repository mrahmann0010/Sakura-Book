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

/**
 * The gateway never answered — the call timed out, or the connection failed
 * outright (phone asleep, off the network, app killed, wrong host).
 *
 * Separate from `SmsSendFailedError` because the two mean different things to
 * whoever reads the message: that one is the gateway rejecting a send and
 * saying why, this one is nobody being home. Both are `DomainError`s with the
 * same status, so callers treating SMS as best-effort still catch them
 * identically — the distinction is for the human, not the control flow.
 */
export class SmsGatewayUnreachableError extends DomainError {
  readonly code = "SMS_GATEWAY_UNREACHABLE";
  readonly status = HttpStatus.BAD_GATEWAY;

  constructor(reason: "timeout" | "network", detail: string, timeoutMs?: number) {
    super(
      reason === "timeout"
        ? `SMS gateway did not respond within ${timeoutMs}ms — the phone may be asleep or off the network.`
        : `SMS gateway unreachable: ${detail.slice(0, 200)}`,
    );
  }
}
