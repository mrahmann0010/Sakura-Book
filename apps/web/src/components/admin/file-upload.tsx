"use client";

import { useId, useState, type ChangeEvent } from "react";

import { AdminApiError } from "@/lib/api/admin";

/**
 * A single-file upload control. Used for both the cover image and the sample
 * PDF — the two differ only in `accept` and which endpoint `uploadFn` calls.
 *
 * Uploads immediately on selection rather than waiting for the book form's
 * own submit: the file has to exist in storage before the book row can
 * reference its URL, and doing that eagerly means the "Saving…" state on the
 * main form is never also waiting on a multi-megabyte upload.
 */
export function FileUpload({
  label,
  accept,
  uploadFn,
  onUploaded,
}: {
  label: string;
  accept: string;
  uploadFn: (file: File) => Promise<{ url: string; fileName?: string }>;
  onUploaded: (result: { url: string; fileName?: string }) => void;
}) {
  const id = useId();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Uploading cannot work at all here, as opposed to this file having failed. */
  const [blocked, setBlocked] = useState(false);

  async function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Cleared immediately so selecting the same file twice still fires `onChange`.
    event.target.value = "";
    if (!file) return;

    setUploading(true);
    setError(null);
    setBlocked(false);
    try {
      onUploaded(await uploadFn(file));
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Upload failed.");
      /* An unconfigured bucket is not something the operator can retry their
         way out of, and the message alone ("set SUPABASE_URL and
         SUPABASE_SERVICE_ROLE_KEY") reads as someone else's problem while the
         book they were filling in stays unsaveable. The URL field below takes
         a pasted link and is the way through, so say so here rather than
         leaving them to notice its hint. */
      setBlocked(err instanceof AdminApiError && err.code === "STORAGE_NOT_CONFIGURED");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <label htmlFor={id} className="text-caption tracking-eyebrow text-muted mb-1 block uppercase">
        {label}
      </label>
      <input
        id={id}
        type="file"
        accept={accept}
        disabled={uploading}
        onChange={(event) => void handleChange(event)}
        className="text-13.5 text-secondary file:rounded-control file:border-rule file:bg-tint file:text-13.5 file:text-ink block w-full file:mr-3 file:border file:px-3 file:py-1.5"
      />
      {uploading ? <p className="text-13.5 text-muted mt-1">Uploading…</p> : null}
      {error ? <p className="text-13.5 text-clay-deep mt-1">{error}</p> : null}
      {blocked ? (
        <p className="text-13.5 text-secondary mt-1">
          Paste a link into the URL field below instead — the book saves either way.
        </p>
      ) : null}
    </div>
  );
}
