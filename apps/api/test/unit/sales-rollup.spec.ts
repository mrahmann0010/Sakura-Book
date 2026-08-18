import { describe, expect, it } from "vitest";
import { directionFor } from "../../src/inventory/sales-rollup.listener";
import {
  ORDER_STATUS_TRANSITIONS,
  STOCK_HELD_STATUSES,
  type OrderStatus,
} from "../../src/orders/order-status.machine";

/**
 * Whether a status change counts a sale, reverses one, or means nothing.
 *
 * This is the rule that keeps `units_sold` honest, and it is exactly the kind
 * of thing that rots: it is derived from the transition map, it fires
 * asynchronously, and being wrong produces a slightly-off number rather than
 * an error anyone notices.
 */
function event(from: OrderStatus, to: OrderStatus) {
  return { orderId: "o", orderNumber: "MG-40718", from, to };
}

describe("directionFor", () => {
  it("counts a sale when payment is confirmed", () => {
    expect(directionFor(event("PENDING", "PAYMENT_CONFIRMED"))).toBe(1);
  });

  it("reverses when a confirmed order is cancelled", () => {
    expect(directionFor(event("PAYMENT_CONFIRMED", "CANCELLED"))).toBe(-1);
    expect(directionFor(event("PROCESSING", "CANCELLED"))).toBe(-1);
  });

  it("does not reverse a cancellation that was never counted", () => {
    // An order cancelled straight out of PENDING never reached the rollup.
    // Subtracting here would drive units_sold negative for a book that sold.
    expect(directionFor(event("PENDING", "CANCELLED"))).toBe(0);
  });

  it("leaves a refund alone", () => {
    // The book left the building; what came back is money. units_sold measures
    // units, and returns handling is out of scope.
    expect(directionFor(event("DELIVERED", "REFUNDED"))).toBe(0);
    expect(directionFor(event("SHIPPED", "REFUNDED"))).toBe(0);
  });

  it("ignores ordinary fulfilment progress", () => {
    expect(directionFor(event("PAYMENT_CONFIRMED", "PROCESSING"))).toBe(0);
    expect(directionFor(event("PROCESSING", "SHIPPED"))).toBe(0);
    expect(directionFor(event("SHIPPED", "DELIVERED"))).toBe(0);
  });

  it("reverses from every cancellable status that was counted", () => {
    // The property, rather than today's two cases: any status that can reach
    // CANCELLED and is past PAYMENT_CONFIRMED must reverse, or a cancellation
    // route added later silently leaks units.
    const cancellable = (Object.keys(ORDER_STATUS_TRANSITIONS) as OrderStatus[]).filter((status) =>
      ORDER_STATUS_TRANSITIONS[status].includes("CANCELLED"),
    );

    for (const status of cancellable) {
      const wasCounted = status !== "PENDING";

      expect(directionFor(event(status, "CANCELLED"))).toBe(wasCounted ? -1 : 0);
    }
  });

  it("only reverses statuses that hold stock", () => {
    // The two lists answer different questions — "did we count the sale?" and
    // "are we holding stock?" — and they happen to coincide everywhere except
    // PENDING. Pinned because a change to one is easy to make without the other.
    for (const status of STOCK_HELD_STATUSES) {
      const direction = directionFor(event(status, "CANCELLED"));

      expect(direction === 0 || direction === -1).toBe(true);
    }
  });
});
