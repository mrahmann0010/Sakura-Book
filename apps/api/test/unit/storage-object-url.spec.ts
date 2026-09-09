import type { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import type { Env } from "../../src/config/env.schema";
import { StorageNotConfiguredError } from "../../src/storage/storage.errors";
import { StorageService } from "../../src/storage/storage.service";

/* --------------------------------------------------------------------------
   Where an uploaded file goes, and where it is then read from.

   Two URLs that look alike and are not: the S3 endpoint the bytes are PUT to,
   which carries a credential and is addressed path-style, and the CDN domain
   the object is served at, which is what gets stored on the book row and
   rendered in a page. They are configured separately (S3_ENDPOINT_URL and
   S3_PUBLIC_BASE_URL) precisely because they are different hosts, and swapping
   one for the other is the mistake worth a test.
   -------------------------------------------------------------------------- */

const GARAGE: Partial<Env> = {
  S3_ENDPOINT_URL: "https://garage.example.com",
  S3_ACCESS_KEY_ID: "GK31c2f218a2e44f485b94239e",
  S3_SECRET_ACCESS_KEY: "b892c0665f0ada8a4755dae98baa3b133590e11dae3bcc1f9d769d67f16c3835",
  S3_BUCKET: "projectsakura-media",
  S3_PUBLIC_BASE_URL: "https://cdn.example.com",
  S3_REGION: "garage",
  S3_USE_PATH_STYLE: true,
  S3_PUBLIC_INCLUDE_BUCKET: false,
};

function serviceWith(env: Partial<Env>): StorageService {
  const config = {
    get: (key: keyof Env) => env[key],
  } as unknown as ConfigService<Env, true>;
  return new StorageService(config);
}

describe("StorageService", () => {
  it("serves objects from the CDN domain, under this app's own prefix", () => {
    /* The prefix is what keeps this shop's files apart from the academy app's
       in a bucket both write to, so it belongs in the stored URL. */
    expect(serviceWith(GARAGE).publicUrl("covers/3f2c.jpg")).toBe(
      "https://cdn.example.com/sakura-book/covers/3f2c.jpg",
    );
  });

  it("puts the bucket in the public URL only when the deployment does", () => {
    /* Garage's web endpoint resolves the bucket from a domain alias, so it is
       absent above. MinIO and R2 path-style public reads keep it in the path. */
    expect(
      serviceWith({ ...GARAGE, S3_PUBLIC_INCLUDE_BUCKET: true }).publicUrl("pdfs/3f2c.pdf"),
    ).toBe("https://cdn.example.com/projectsakura-media/sakura-book/pdfs/3f2c.pdf");
  });

  it("PUTs to the S3 endpoint, signed, and returns the CDN URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const uploaded = await serviceWith(GARAGE).upload(
      "covers/3f2c.jpg",
      Buffer.from("jpeg bytes"),
      "image/jpeg",
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    /* Path-style: the bucket is in the endpoint's path, not in its host. */
    expect(url).toBe("https://garage.example.com/projectsakura-media/sakura-book/covers/3f2c.jpg");
    expect(init.method).toBe("PUT");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=GK31c2f2.+\/garage\/s3\//);
    /* Written at upload time so the object carries its own cache policy, with
       no CDN rule to reproduce it. */
    expect(headers["cache-control"]).toBe("public, max-age=31536000, immutable");

    /* What is stored on the book row is the readable URL, never the endpoint. */
    expect(uploaded).toEqual({
      path: "sakura-book/covers/3f2c.jpg",
      url: "https://cdn.example.com/sakura-book/covers/3f2c.jpg",
    });

    vi.unstubAllGlobals();
  });

  it("names every missing setting at once rather than one per restart", () => {
    const service = serviceWith({ ...GARAGE, S3_BUCKET: undefined, S3_PUBLIC_BASE_URL: undefined });

    expect(() => service.publicUrl("covers/3f2c.jpg")).toThrow(StorageNotConfiguredError);
    expect(() => service.publicUrl("covers/3f2c.jpg")).toThrow(/S3_BUCKET, S3_PUBLIC_BASE_URL/);
  });
});
