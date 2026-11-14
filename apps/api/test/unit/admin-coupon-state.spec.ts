import { adminCouponCreateRequestSchema } from "@sakura/contracts";
import { describe, expect, it } from "vitest";
import { couponState } from "../../src/admin/coupons/admin-coupons.service";
import type { Coupon } from "../../src/coupons/coupon.types";

/**
 * The tab a code sits under in the panel must be the answer a customer typing
 * it gets from CouponsService.evaluate — otherwise "Active" on screen and
 * "this code expired" at the till disagree.
 */
const now = new Date("2026-11-14T12:00:00Z");

function row(overrides: Partial<Coupon>): Coupon {
  return {
    isActive: true,
    startsAt: null,
    expiresAt: null,
    maxUses: null,
    timesUsed: 0,
    ...overrides,
  } as Coupon;
}

describe("couponState", () => {
  it("is ACTIVE with no limits", () => {
    expect(couponState(row({}), now)).toBe("ACTIVE");
  });

  it("is DISABLED when switched off, even if otherwise expired", () => {
    expect(
      couponState(row({ isActive: false, expiresAt: new Date("2026-01-01T00:00:00Z") }), now),
    ).toBe("DISABLED");
  });

  it("is SCHEDULED before the start date", () => {
    expect(couponState(row({ startsAt: new Date("2026-12-01T00:00:00Z") }), now)).toBe("SCHEDULED");
  });

  it("is EXPIRED after the end date", () => {
    expect(couponState(row({ expiresAt: new Date("2026-11-01T00:00:00Z") }), now)).toBe("EXPIRED");
  });

  it("is USED_UP once timesUsed reaches maxUses", () => {
    expect(couponState(row({ maxUses: 5, timesUsed: 5 }), now)).toBe("USED_UP");
    expect(couponState(row({ maxUses: 5, timesUsed: 4 }), now)).toBe("ACTIVE");
  });
});

describe("adminCouponCreateRequestSchema", () => {
  const base = {
    code: " eid-2026 ",
    discountType: "PERCENTAGE" as const,
    discountValue: 15,
    minOrderCents: null,
    maxDiscountCents: null,
    maxUses: null,
    startsAt: null,
    expiresAt: null,
    isActive: true,
  };

  it("trims and uppercases the code", () => {
    expect(adminCouponCreateRequestSchema.parse(base).code).toBe("EID-2026");
  });

  it("rejects spaces and symbols in the code", () => {
    expect(adminCouponCreateRequestSchema.safeParse({ ...base, code: "EID 2026!" }).success).toBe(
      false,
    );
  });

  it("rejects a percentage above 100", () => {
    expect(adminCouponCreateRequestSchema.safeParse({ ...base, discountValue: 120 }).success).toBe(
      false,
    );
  });

  it("allows a fixed amount above 100", () => {
    expect(
      adminCouponCreateRequestSchema.safeParse({
        ...base,
        discountType: "FIXED_AMOUNT",
        discountValue: 20000,
      }).success,
    ).toBe(true);
  });

  it("rejects an end date before the start date", () => {
    expect(
      adminCouponCreateRequestSchema.safeParse({
        ...base,
        startsAt: "2026-12-10T00:00:00+06:00",
        expiresAt: "2026-12-01T23:59:59+06:00",
      }).success,
    ).toBe(false);
  });
});
