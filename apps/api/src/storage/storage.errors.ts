import { HttpStatus } from "@nestjs/common";
import { DomainError } from "../common/errors";

/**
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are unset.
 *
 * A closed door rather than a silent no-op: an upload that appeared to
 * succeed but wrote nothing would leave a book pointing at a URL nobody ever
 * stored anything at. 503 rather than a 500, so a client (or an operator
 * watching logs) can tell "not configured yet" from "broken".
 */
export class StorageNotConfiguredError extends DomainError {
  readonly code = "STORAGE_NOT_CONFIGURED";
  readonly status = HttpStatus.SERVICE_UNAVAILABLE;

  constructor() {
    super("File storage is not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }
}

/** The Supabase Storage API rejected the upload — bad key, missing bucket, etc. */
export class StorageUploadFailedError extends DomainError {
  readonly code = "STORAGE_UPLOAD_FAILED";
  readonly status = HttpStatus.BAD_GATEWAY;

  constructor(status: number, body: string) {
    super(`Storage upload failed (${status}): ${body.slice(0, 500)}`);
  }
}
