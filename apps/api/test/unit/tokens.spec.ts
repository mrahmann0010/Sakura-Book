import { describe, expect, it } from "vitest";
import { accessClaimsSchema, hashRefreshToken, mintRefreshToken } from "../../src/admin/auth/tokens";

describe("refresh tokens", () => {
  it("mints unguessable, unique values", () => {
    const tokens = new Set(Array.from({ length: 100 }, mintRefreshToken));

    expect(tokens.size).toBe(100);
    // 32 bytes base64url — the entropy is what makes a fast hash acceptable
    // for the stored form, so a shorter token would invalidate that decision.
    for (const token of tokens) expect(token.length).toBeGreaterThanOrEqual(43);
  });

  it("is url-safe, so a cookie round-trip cannot alter it", () => {
    // A `+` or `/` in a cookie value is legal but gets mangled by enough
    // middleware that it is not worth finding out which; base64url avoids the
    // question. A token that survives the round-trip 99% of the time is a
    // session that drops 1% of staff at random.
    for (let index = 0; index < 50; index++) {
      expect(mintRefreshToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("hashes deterministically", () => {
    const token = mintRefreshToken();

    // The lookup is `where token_hash = sha256(presented)`, so a
    // non-deterministic hash would mean no session is ever found again.
    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
  });

  it("does not store the token itself", () => {
    const token = mintRefreshToken();

    expect(hashRefreshToken(token)).not.toBe(token);
    expect(hashRefreshToken(token)).not.toContain(token);
  });
});

describe("accessClaimsSchema", () => {
  const valid = {
    sub: "00000000-0000-4000-8000-000000000001",
    sid: "00000000-0000-4000-8000-000000000002",
    role: "ADMIN",
    email: "owner@shop.test",
    iat: 1_700_000_000,
    exp: 1_700_000_900,
  };

  it("accepts a well-formed payload", () => {
    expect(accessClaimsSchema.parse(valid)).toEqual(valid);
  });

  it("rejects a payload missing the session id", () => {
    // A token minted before `sid` existed would verify cryptographically and
    // then be read as undefined in the guard — an authorisation decision made
    // on a missing field. Parsing turns that into a clean 401.
    const { sid: _sid, ...withoutSid } = valid;

    expect(() => accessClaimsSchema.parse(withoutSid)).toThrow();
  });

  it("rejects a role that is not one of ours", () => {
    expect(() => accessClaimsSchema.parse({ ...valid, role: "SUPERUSER" })).toThrow();
  });
});
