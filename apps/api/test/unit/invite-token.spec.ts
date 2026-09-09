import { describe, expect, it } from "vitest";

import {
  INVITE_TOKEN_LENGTH,
  generateInviteToken,
  normalizeInviteToken,
} from "../../src/waitlist/invite-token";

/* These tokens are sized against an SMS segment, so the length is not an
   incidental detail — growing it silently is what pushed the Bangla invite to
   three billed segments in the first place. */
describe("invite tokens", () => {
  it("is 11 Crockford Base32 characters", () => {
    for (let i = 0; i < 200; i += 1) {
      const token = generateInviteToken();
      expect(token).toHaveLength(INVITE_TOKEN_LENGTH);
      expect(token).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{11}$/);
    }
  });

  it("never emits the characters that are ambiguous when read off a phone", () => {
    const minted = Array.from({ length: 500 }, generateInviteToken).join("");
    for (const ambiguous of ["I", "L", "O", "U"]) {
      expect(minted).not.toContain(ambiguous);
    }
  });

  it("does not repeat across a large batch", () => {
    const minted = new Set(Array.from({ length: 5000 }, generateInviteToken));
    expect(minted.size).toBe(5000);
  });

  /* The token that comes back is not always the token we sent: SMS clients
     lowercase links and people retype them from screenshots. */
  it("resolves a lowercased link to the stored token", () => {
    const token = generateInviteToken();
    expect(normalizeInviteToken(token.toLowerCase())).toBe(token);
  });

  it("forgives the substitutions Crockford exists to forgive", () => {
    expect(normalizeInviteToken("O")).toBe("0");
    expect(normalizeInviteToken("I")).toBe("1");
    expect(normalizeInviteToken("l")).toBe("1");
  });

  it("leaves a mangled token unmatched rather than throwing", () => {
    expect(() => normalizeInviteToken("!!not-a-token!!")).not.toThrow();
  });
});
