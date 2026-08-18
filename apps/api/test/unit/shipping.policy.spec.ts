import { describe, expect, it } from "vitest";
import type { ShippingConfig } from "../../src/config/shipping.config";
import { ShippingPolicy } from "../../src/shipping/shipping.policy";

/**
 * The delivery ladder — the shop's postage policy, formerly two constants in a
 * browser bundle a customer could edit.
 *
 * Constructed with a literal config rather than through DI, which is the
 * payoff for ShippingPolicy taking its numbers as a dependency instead of
 * reading ConfigService itself: the money rules can be pinned to exact figures
 * without booting Nest or reading an .env.
 */
const config: ShippingConfig = Object.freeze({
  currency: "BDT",
  flatRateCents: 6000,
  freeDeliveryThresholdCents: 150000,
});

const policy = new ShippingPolicy(config);

describe("ShippingPolicy.quote", () => {
  it("charges the flat rate below the threshold", () => {
    expect(policy.quote(100000, 1)).toEqual({
      baseCents: 6000,
      chargedCents: 6000,
      creditCents: 0,
    });
  });

  it("waives postage at exactly the threshold, not just above it", () => {
    // The boundary, spelled out because "over ৳1,500" in the copy and `>=` in
    // the code are not the same rule, and a customer landing exactly on the
    // threshold is the one who notices.
    expect(policy.quote(150000, 2)).toEqual({
      baseCents: 6000,
      chargedCents: 0,
      creditCents: 6000,
    });
  });

  it("reports the waived amount as a credit rather than a zeroed base", () => {
    // The summary rail draws three rows: what postage would have cost, what is
    // charged, and the waiver as a credit line. Collapsing base to zero when
    // it is waived would make the credit row unrenderable.
    const quote = policy.quote(200000, 1);

    expect(quote.baseCents).toBe(6000);
    expect(quote.creditCents).toBe(6000);
  });

  it("charges nothing for an empty cart", () => {
    expect(policy.quote(0, 0)).toEqual({ baseCents: 0, chargedCents: 0, creditCents: 0 });
  });

  it("charges postage on a zero-subtotal cart that still has lines", () => {
    // Emptiness is tested by line count, not subtotal: a fully-discounted cart
    // totals zero and still has to be posted. Note this also means such a cart
    // qualifies for no waiver — it is below the threshold — which is the
    // intended reading.
    expect(policy.quote(0, 1).chargedCents).toBe(6000);
  });

  it("uses a region override in place of the flat rate", () => {
    expect(policy.quote(100000, 1, 12000).chargedCents).toBe(12000);
  });

  it("waives an overridden rate too", () => {
    // "Free delivery over ৳1,500" must mean the same thing outside Dhaka as
    // inside it. A threshold that only waived the cheap rate would surprise
    // exactly the customers who are already paying more.
    expect(policy.quote(150000, 1, 12000)).toEqual({
      baseCents: 12000,
      chargedCents: 0,
      creditCents: 12000,
    });
  });

  it("falls back to the flat rate for a null override", () => {
    // Null is what RegionsService returns for "flat rate applies" and for "no
    // region chosen yet", and both must price as the national rate.
    expect(policy.quote(100000, 1, null).chargedCents).toBe(6000);
  });
});
