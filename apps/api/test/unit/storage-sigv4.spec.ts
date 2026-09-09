import { describe, expect, it } from "vitest";
import { encodeObjectKey, sha256Hex, signS3Request } from "../../src/storage/sigv4";

/* --------------------------------------------------------------------------
   The signer, pinned against a signature produced by botocore.

   The expected value below was not written by hand or taken from a blog post:
   it is what `botocore.auth.S3SigV4Auth` produces for this exact request, with
   its clock frozen to the timestamp used here. S3SigV4Auth and not the generic
   SigV4Auth, and the difference is not cosmetic: the generic signer encodes the
   URI path a second time (a key with a space signs as `%2520`), which is right
   for most AWS services and wrong for S3 — so signing against that reference
   would produce a signer that agrees with a test and is rejected by Garage. That matters more than a
   generic conformance test would, because botocore is the signer the *other*
   Sakura app uses against the same Garage cluster and the same bucket — so
   this asserts the two apps sign identically, which is the property that
   decides whether an upload from here is accepted at all.

   Regenerate it (needs `pip install botocore`) with:

     python - <<'PY'
     import datetime, hashlib
     import botocore.auth as ba
     from botocore.auth import S3SigV4Auth
     from botocore.awsrequest import AWSRequest
     from botocore.credentials import Credentials

     class Frozen(datetime.datetime):
         @classmethod
         def utcnow(cls): return cls(2024, 1, 1, 0, 0, 0)
     ba.datetime.datetime = Frozen

     body = b"hello garage"
     req = AWSRequest(
         method="PUT",
         url="https://garage.example.com/projectsakura-media/sakura-book/covers/9f1c%20a.jpg",
         data=body,
         headers={
             "host": "garage.example.com",
             "content-type": "image/jpeg",
             "cache-control": "public, max-age=31536000, immutable",
             "x-amz-content-sha256": hashlib.sha256(body).hexdigest(),
         },
     )
     S3SigV4Auth(Credentials("AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"),
               "s3", "garage").add_auth(req)
     print(req.headers["Authorization"])
     PY
   -------------------------------------------------------------------------- */

const CREDENTIALS = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "garage",
} as const;

/* A space in the key, so the test covers the one place where the encoding of
   the path and the string that gets signed could drift apart. */
const OBJECT_KEY = "projectsakura-media/sakura-book/covers/9f1c a.jpg";
const BODY = Buffer.from("hello garage");

describe("signS3Request", () => {
  it("matches botocore's signature for the same PUT", () => {
    const headers = signS3Request({
      ...CREDENTIALS,
      method: "PUT",
      url: `https://garage.example.com/${encodeObjectKey(OBJECT_KEY)}`,
      headers: {
        "content-type": "image/jpeg",
        "cache-control": "public, max-age=31536000, immutable",
      },
      payloadSha256: sha256Hex(BODY),
      now: new Date("2024-01-01T00:00:00Z"),
    });

    expect(headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20240101/garage/s3/aws4_request, " +
        "SignedHeaders=cache-control;content-type;host;x-amz-content-sha256;x-amz-date, " +
        "Signature=6b19f72fdfb56e8fca27a820c02f695ad66d39dcde2f361e1d3e4991445cb3db",
    );
  });

  it("sends the timestamp and payload hash it signed, and leaves host to fetch", () => {
    const headers = signS3Request({
      ...CREDENTIALS,
      method: "PUT",
      url: "https://garage.example.com/bucket/key.jpg",
      headers: { "content-type": "image/jpeg" },
      payloadSha256: sha256Hex(BODY),
      now: new Date("2024-01-01T00:00:00Z"),
    });

    expect(headers["x-amz-date"]).toBe("20240101T000000Z");
    expect(headers["x-amz-content-sha256"]).toBe(sha256Hex(BODY));
    /* Signed, but derived from the URL by fetch rather than set twice. */
    expect(headers.host).toBeUndefined();
    expect(headers.authorization).toContain("host");
  });

  it("escapes a key the way it signs it", () => {
    /* `encodeURIComponent` alone would leave these three untouched, and a
       server that canonicalised them differently would reject the signature. */
    expect(encodeObjectKey("covers/a b(1)*'.jpg")).toBe("covers/a%20b%281%29%2A%27.jpg");
    /* Separators survive; a UUID key is unchanged. */
    expect(encodeObjectKey("sakura-book/covers/9f1c-4d.jpg")).toBe(
      "sakura-book/covers/9f1c-4d.jpg",
    );
  });
});
