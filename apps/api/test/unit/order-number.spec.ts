import { describe, expect, it } from "vitest";
import { ORDER_NUMBER_PREFIX, generateOrderNumber } from "../../src/orders/order-number";

/**
 * The customer-facing order id.
 *
 * The format is a promise made in the confirmation copy — "eight characters,
 * like NB-40718" — and in the design system's `OrderId` component, so it is
 * pinned here rather than left to be discovered when a nine-character number
 * overflows a printed layout.
 */
describe("generateOrderNumber", () => {
  it("matches the promised eight-character format", () => {
    for (let index = 0; index < 200; index += 1) {
      const number = generateOrderNumber();

      expect(number).toMatch(new RegExp(`^${ORDER_NUMBER_PREFIX}-\\d{5}$`));
      expect(number).toHaveLength(8);
    }
  });

  it("never emits a leading-zero number that would read as shorter", () => {
    // The lower bound is 10000, not 0: `NB-04718` is eight characters but
    // reads as a typo over the phone, and a customer dropping the zero would
    // look up a different, real order.
    for (let index = 0; index < 200; index += 1) {
      expect(generateOrderNumber()).not.toMatch(/-0/);
    }
  });

  it("does not repeat itself over a small sample", () => {
    // Not a uniqueness guarantee — the unique index is what actually holds,
    // and the insert retries on collision. This only catches the failure where
    // the generator is accidentally deterministic.
    const drawn = new Set(Array.from({ length: 500 }, () => generateOrderNumber()));

    expect(drawn.size).toBeGreaterThan(450);
  });
});
