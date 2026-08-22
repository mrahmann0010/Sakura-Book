import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env.schema";
import { StorageNotConfiguredError, StorageUploadFailedError } from "./storage.errors";

export type UploadedFile = {
  /** Storage object key, e.g. "covers/3f2c.../title.jpg" — not a URL. */
  path: string;
  /** The public URL StorageService's own bucket serves it at. */
  url: string;
};

/**
 * A thin client for Supabase Storage's REST API.
 *
 * Plain `fetch` rather than `@supabase/supabase-js`: the only two operations
 * this app needs are "PUT a file" and "know its public URL", and the SDK's
 * realtime/auth/postgrest surface is not a reason to add a dependency this
 * codebase otherwise avoids — see password.ts's scrypt-over-bcrypt reasoning
 * for the same stance applied to a native module instead of a wire client.
 *
 * The bucket is assumed public. A signed-URL flow for a private bucket would
 * need refreshing before every render, which is real complexity this feature
 * does not need: a book cover and its sample PDF are marketing assets shown to
 * anyone browsing the shop, not secrets.
 */
@Injectable()
export class StorageService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  /**
   * Upload one file, overwriting anything already at `path`.
   *
   * `x-upsert: true` rather than failing on conflict — `path` is always a
   * freshly generated UUID-prefixed key (see admin-uploads.controller.ts), so
   * a collision would only ever mean the same request retried, and the retry
   * should win.
   */
  async upload(path: string, body: Buffer, contentType: string): Promise<UploadedFile> {
    const url = this.config.get("SUPABASE_URL", { infer: true });
    const serviceRoleKey = this.config.get("SUPABASE_SERVICE_ROLE_KEY", { infer: true });
    const bucket = this.config.get("SUPABASE_STORAGE_BUCKET", { infer: true });

    if (!url || !serviceRoleKey) throw new StorageNotConfiguredError();

    const endpoint = `${url.replace(/\/+$/, "")}/storage/v1/object/${bucket}/${path}`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "content-type": contentType,
        "x-upsert": "true",
      },
      body,
    });

    if (!response.ok) {
      throw new StorageUploadFailedError(response.status, await response.text());
    }

    return { path, url: this.publicUrl(path) };
  }

  /** Where the object at `path` is served from — a plain, unsigned URL. */
  publicUrl(path: string): string {
    const url = this.config.get("SUPABASE_URL", { infer: true });
    const bucket = this.config.get("SUPABASE_STORAGE_BUCKET", { infer: true });

    if (!url) throw new StorageNotConfiguredError();

    return `${url.replace(/\/+$/, "")}/storage/v1/object/public/${bucket}/${path}`;
  }
}
