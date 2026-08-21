import { describe, expect, it } from "vitest";
import { hashPassword, needsRehash, verifyPassword } from "../../src/admin/auth/password";

/**
 * The password KDF. No database, no Nest — scrypt is a pure function and this
 * is the one piece of the auth module where a subtle mistake is silent: a
 * broken verifier that returns `true` too often does not throw, does not log,
 * and passes every happy-path smoke test.
 *
 * These are slow by construction (~100ms per hash, which is the entire point
 * of the cost parameters) so the suite deliberately keeps the number of hashes
 * small rather than looping over cases.
 */
describe("password hashing", () => {
  it("verifies a correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");

    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");

    await expect(verifyPassword("correct horse battery stapl", hash)).resolves.toBe(false);
  });

  it("salts, so the same password hashes differently every time", async () => {
    const [first, second] = await Promise.all([hashPassword("same"), hashPassword("same")]);

    // Without a per-hash salt, identical passwords produce identical hashes and
    // the table becomes a map of which staff share one.
    expect(first).not.toBe(second);
    await expect(verifyPassword("same", first)).resolves.toBe(true);
    await expect(verifyPassword("same", second)).resolves.toBe(true);
  });

  it("does not truncate long passphrases", async () => {
    // bcrypt silently ignores everything past 72 bytes, which makes these two
    // the same password. The reason this codebase does not use bcrypt.
    const base = "x".repeat(72);
    const hash = await hashPassword(`${base}-alpha`);

    await expect(verifyPassword(`${base}-omega`, hash)).resolves.toBe(false);
  });

  it("normalises unicode, so the same characters typed differently still match", async () => {
    // é as one codepoint vs e + combining accent. Two byte sequences, one
    // password as far as the person typing it is concerned — and which one a
    // keyboard produces is a platform detail.
    const hash = await hashPassword("café-password-long");

    await expect(verifyPassword("café-password-long", hash)).resolves.toBe(true);
  });

  describe("malformed stored hashes", () => {
    // Every one of these must be false rather than a throw: a corrupt row is
    // an account that cannot be logged into, not a 500 that distinguishes it
    // from every other account.
    it.each([
      ["empty", ""],
      ["not our format", "$2b$12$abcdefghijklmnopqrstuv"],
      ["wrong field count", "scrypt$65536$8$1$salt"],
      ["unknown algorithm", "argon2$65536$8$1$c2FsdA==$aGFzaA=="],
      ["absurd cost", "scrypt$999999999$8$1$c2FsdA==$aGFzaA=="],
      ["non-numeric cost", "scrypt$banana$8$1$c2FsdA==$aGFzaA=="],
    ])("returns false for %s", async (_label, stored) => {
      await expect(verifyPassword("anything", stored)).resolves.toBe(false);
    });
  });

  describe("needsRehash", () => {
    it("is false for a hash at current parameters", async () => {
      expect(needsRehash(await hashPassword("current-parameters"))).toBe(false);
    });

    it("is true for a hash at a lower cost", () => {
      expect(needsRehash("scrypt$16384$8$1$c2FsdA==$aGFzaA==")).toBe(true);
    });

    it("is true for an unparseable hash, so a broken row gets replaced on next login", () => {
      expect(needsRehash("nonsense")).toBe(true);
    });
  });
});
