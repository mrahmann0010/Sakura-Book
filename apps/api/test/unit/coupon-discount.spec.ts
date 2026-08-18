import { describe, expect, it } from "vitest";
import { CouponsService } from "../../src/coupons/coupons.service";
import type { Coupon } from "../../src/coupons/coupon.types";

/**
 * Discount arithmetic — the one calculation on the whole order that can, if it
 * is wrong in the wrong direction, hand out money.
 *
 * `computeDiscountCents` reads no database, so the service is constructed with
 * a null DbService: the method under test never touches it, and faking one
 * would be pretending this function has a dependency it does not have.
 */
const service = new CouponsService(null as never);

function coupon(overrides: Partial<Coupon>): Coupon {
  return {
    discountType: "PERCENTAGE",
    discountValue: 10,
    maxDiscountCents: null,
    ...overrides,
  } as Coupon;
}

describe("CouponsService.computeDiscountCents", () => {
  it("takes a percentage of the subtotal", () => {
    expect(service.computeDiscountCents(coupon({ discountValue: 10 }), 100000)).toBe(10000);
  });

  it("floors a fractional percentage rather than rounding up", () => {
    // 33% of 1001 is 330.33. Rounding up would give a discount larger than the
    // advertised percentage; the error is capped at one minor unit and always
    // falls the shop's way.
    expect(service.computeDiscountCents(coupon({ discountValue: 33 }), 1001)).toBe(330);
  });

  it("caps a percentage discount at maxDiscountCents", () => {
    expect(
      service.computeDiscountCents(coupon({ discountValue: 50, maxDiscountCents: 20000 }), 100000),
    ).toBe(20000);
  });

  it("applies a fixed amount as-is", () => {
    expect(
      service.computeDiscountCents(
        coupon({ discountType: "FIXED_AMOUNT", discountValue: 20000 }),
        100000,
      ),
    ).toBe(20000);
  });

  it("never discounts more than the subtotal", () => {
    // A ৳200-off coupon on a ৳150 cart must not produce a negative total, and
    // must not silently eat into postage either — the clamp is to the subtotal,
    // not to the order total.
    expect(
      service.computeDiscountCents(
        coupon({ discountType: "FIXED_AMOUNT", discountValue: 20000 }),
        15000,
      ),
    ).toBe(15000);
  });

  it("never returns a negative discount", () => {
    expect(
      service.computeDiscountCents(
        coupon({ discountType: "FIXED_AMOUNT", discountValue: -500 }),
        100000,
      ),
    ).toBe(0);
  });

  it("discounts nothing on an empty subtotal", () => {
    expect(service.computeDiscountCents(coupon({ discountValue: 50 }), 0)).toBe(0);
  });
});
