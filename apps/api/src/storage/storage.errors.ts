import { HttpStatus } from "@nestjs/common";
import { DomainError } from "../common/errors";

/**
 * One or more of the S3 settings are unset.
 *
 * A closed door rather than a silent no-op: an upload that appeared to succeed
 * but wrote nothing would leave a book pointing at a URL nobody ever stored
 * anything at. 503 rather than a 500, so a client (or an operator watching
 * logs) can tell "not configured yet" from "broken".
 */
export class StorageNotConfiguredError extends DomainError {
  readonly code = "STORAGE_NOT_CONFIGURED";
  readonly status = HttpStatus.SERVICE_UNAVAILABLE;

  constructor(missing: readonly string[]) {
    super(`File storage is not configured — set ${missing.join(", ")}.`);
  }
}

/**
 * The object store rejected the upload, or could not be reached at all.
 *
 * `status` is 0 for the second case — a refused connection, a DNS failure, a
 * TLS error — where there is no HTTP response to report. Both are a 502 to the
 * caller: the difference matters to whoever reads the message, not to the
 * admin panel, which can only say the upload did not happen either way.
 */
export class StorageUploadFailedError extends DomainError {
  readonly code = "STORAGE_UPLOAD_FAILED";
  readonly status = HttpStatus.BAD_GATEWAY;

  constructor(status: number, body: string) {
    super(
      status === 0
        ? `Storage upload failed — could not reach the object store: ${body.slice(0, 500)}`
        : `Storage upload failed (${status}): ${body.slice(0, 500)}`,
    );
  }
}
