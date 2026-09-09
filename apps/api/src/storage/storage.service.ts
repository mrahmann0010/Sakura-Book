import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env.schema";
import { encodeObjectKey, sha256Hex, signS3Request } from "./sigv4";
import { StorageNotConfiguredError, StorageUploadFailedError } from "./storage.errors";

export type UploadedFile = {
  /** Full object key in the bucket, e.g. "sakura-book/covers/3f2c….jpg" — not a URL. */
  path: string;
  /** The public URL the object is served at, through the CDN in front of the bucket. */
  url: string;
};

/**
 * How long a stored object may be cached, sent as `Cache-Control` at upload
 * time so it is the object's own header rather than something a CDN rule has
 * to reproduce.
 *
 * A year, immutable, and safe rather than optimistic: every key is a freshly
 * generated UUID (admin-uploads.controller.ts), so replacing a cover writes a
 * *new* key at a *new* URL. The bytes under a given key never change, so there
 * is nothing for a stale cache to be wrong about — and nothing to purge.
 */
const CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * Where this shop's files sit inside the bucket.
 *
 * The bucket is not this app's own: the academy app writes its lesson audio,
 * drill images and mock-test media into the same one, from its own backend. A
 * prefix per application is what keeps two key spaces from colliding, and
 * makes "everything the shop uploaded" a single listing rather than a filter
 * over a mixed one.
 *
 * A constant rather than a setting, because nothing downstream can cope with
 * it changing: it is baked into every URL already stored on a book row. And a
 * constant in this package rather than in @sakura/contracts, because the web
 * app does not parse these paths — it renders the stored URL as it stands — so
 * only this side knows or needs to know the layout.
 */
const MEDIA_PREFIX = "sakura-book";

/** The five settings with no sensible default; named individually when unset. */
const REQUIRED_SETTINGS = [
  "S3_ENDPOINT_URL",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_BUCKET",
  "S3_PUBLIC_BASE_URL",
] as const;

type S3Settings = {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
  region: string;
  pathStyle: boolean;
  publicIncludesBucket: boolean;
};

/**
 * A thin client for the S3 API of the self-hosted Garage cluster.
 *
 * The same bucket the Nihonova academy app writes its lesson media into from
 * its own backend — hence `MEDIA_PREFIX` on every key here, so two
 * applications can share one bucket without sharing a namespace. Everything
 * below matches that app's `services/storage.py` on purpose: the same env var
 * names, the same path-style and public-URL switches, the same year-long
 * immutable cache header. Two codebases, one storage configuration to reason
 * about, and one set of values to copy between two `.env` files.
 *
 * Plain `fetch` plus a hand-written SigV4 signer (see sigv4.ts) rather than
 * `@aws-sdk/client-s3`, for the reason this file has always given for avoiding
 * a vendor SDK: the app does one thing here — PUT some bytes — and the SDK
 * brings a hundred packages, a credential-provider chain and a middleware
 * stack to do it. The signing is the only genuinely hard part, and it is
 * pinned by a test against the signature botocore produces for the same
 * request (test/unit/storage-sigv4.spec.ts).
 *
 * Reads are not this service's job, and never touch this endpoint or these
 * credentials. The bucket is published through the Cloudflare-fronted domain
 * in `S3_PUBLIC_BASE_URL`, and that is the URL stored on the book row and
 * rendered in the page: a visitor's browser fetches from Cloudflare's edge,
 * which falls through to Garage only on a MISS. Writes go to the S3 endpoint,
 * reads come from the CDN, and the two are different hosts on purpose — the
 * same split `services/storage.py` describes on the academy side.
 */
@Injectable()
export class StorageService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  /**
   * Upload one file, overwriting anything already at `path`.
   *
   * `path` is app-relative — `covers/<uuid>.jpg` — and the shared media prefix
   * is added here rather than at the call site, so one place decides where
   * this app's files sit inside a bucket it does not own.
   *
   * A plain PUT overwrites, and no conditional header is asked for: `path` is
   * always a freshly generated UUID key, so a collision would only ever mean
   * the same request retried, and the retry should win.
   */
  async upload(path: string, body: Buffer, contentType: string): Promise<UploadedFile> {
    const settings = this.settings();
    const key = this.objectKey(path);
    const url = this.originUrl(settings, key);

    const headers = signS3Request({
      method: "PUT",
      url,
      region: settings.region,
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
      headers: {
        "content-type": contentType || "application/octet-stream",
        "cache-control": CACHE_CONTROL,
      },
      payloadSha256: sha256Hex(body),
    });

    let response: Response;
    try {
      response = await fetch(url, { method: "PUT", headers, body });
    } catch (error) {
      /* A refused connection, a DNS failure or a TLS error reaches the caller
         as the same 502 as a rejected upload: from the admin's side both are
         "storage did not take the file", and the distinction belongs in the
         message rather than in the status. */
      throw new StorageUploadFailedError(0, error instanceof Error ? error.message : String(error));
    }

    if (!response.ok) {
      throw new StorageUploadFailedError(response.status, await response.text());
    }

    return { path: key, url: this.publicUrl(path) };
  }

  /**
   * Where the object uploaded at `path` is served from — a plain, unsigned URL
   * on the CDN domain, never on the S3 endpoint.
   *
   * Whether the bucket name appears in it is a property of how the bucket is
   * *published*, not of how it is addressed over the S3 API, which is why
   * `S3_PUBLIC_INCLUDE_BUCKET` is a separate switch from `S3_USE_PATH_STYLE`:
   * Garage's web endpoint resolves the bucket from the Host header via a
   * domain alias (`<base>/<key>`), while MinIO and R2 path-style public reads
   * keep it in the path (`<base>/<bucket>/<key>`).
   */
  publicUrl(path: string): string {
    const settings = this.settings();
    const base = settings.publicBaseUrl.replace(/\/+$/, "");
    const key = encodeObjectKey(this.objectKey(path));

    return settings.publicIncludesBucket
      ? `${base}/${encodeObjectKey(settings.bucket)}/${key}`
      : `${base}/${key}`;
  }

  /** App-relative path → the key it occupies in the shared bucket. */
  private objectKey(path: string): string {
    return `${MEDIA_PREFIX}/${path.replace(/^\/+/, "")}`;
  }

  /** The S3 API URL to PUT to — the endpoint, addressed the way it expects. */
  private originUrl(settings: S3Settings, key: string): string {
    const encodedKey = encodeObjectKey(key);
    const endpoint = new URL(settings.endpoint);
    const prefix = `${endpoint.origin}${endpoint.pathname.replace(/\/+$/, "")}`;

    if (settings.pathStyle) {
      return `${prefix}/${encodeObjectKey(settings.bucket)}/${encodedKey}`;
    }

    /* Virtual-hosted addressing: the bucket becomes a subdomain of the
       endpoint host, which is what R2 and AWS expect. Garage supports it too,
       but only when its `root_domain` is configured — path style is the
       setting that always works on a self-hosted cluster, and is the default. */
    endpoint.host = `${settings.bucket}.${endpoint.host}`;
    return `${endpoint.origin}/${encodedKey}`;
  }

  /**
   * Read the storage settings, or refuse.
   *
   * Every missing name is listed at once rather than one per attempt — the
   * person reading this error is filling in a `.env`, and being told about one
   * of five gaps at a time is four more restarts than it needs to be.
   */
  private settings(): S3Settings {
    const values = {
      S3_ENDPOINT_URL: this.config.get("S3_ENDPOINT_URL", { infer: true }),
      S3_ACCESS_KEY_ID: this.config.get("S3_ACCESS_KEY_ID", { infer: true }),
      S3_SECRET_ACCESS_KEY: this.config.get("S3_SECRET_ACCESS_KEY", { infer: true }),
      S3_BUCKET: this.config.get("S3_BUCKET", { infer: true }),
      S3_PUBLIC_BASE_URL: this.config.get("S3_PUBLIC_BASE_URL", { infer: true }),
    };

    const missing = REQUIRED_SETTINGS.filter((name) => !values[name]);
    if (missing.length > 0) throw new StorageNotConfiguredError(missing);

    return {
      endpoint: values.S3_ENDPOINT_URL as string,
      accessKeyId: values.S3_ACCESS_KEY_ID as string,
      secretAccessKey: values.S3_SECRET_ACCESS_KEY as string,
      bucket: values.S3_BUCKET as string,
      publicBaseUrl: values.S3_PUBLIC_BASE_URL as string,
      region: this.config.get("S3_REGION", { infer: true }),
      pathStyle: this.config.get("S3_USE_PATH_STYLE", { infer: true }),
      publicIncludesBucket: this.config.get("S3_PUBLIC_INCLUDE_BUCKET", { infer: true }),
    };
  }
}
