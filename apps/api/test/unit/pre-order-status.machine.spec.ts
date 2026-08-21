import { describe, expect, it } from "vitest";
import {
  PRE_ORDER_FULFILLMENT_TRANSITIONS,
  PRE_ORDER_PAYMENT_TRANSITIONS,
  canStartFulfillment,
  canTransitionFulfillment,
  canTransitionPayment,
  isFulfillmentTerminal,
  isPaymentTerminal,
} from "../../src/pre-orders/pre-order-status.machine";
import {
  derivePreOrderStatus,
  preOrderFulfillmentStatuses,
  preOrderPaymentStatuses,
  preOrderStatuses,
} from "@sakura/contracts";

/**
 * Two lifecycles, and the one rule that spans them.
 *
 * Asserted against the tables' *properties* wherever possible rather than
 * against today's edges, for the reason order-status.machine.spec.ts gives: a
 * property that holds for every status keeps holding when a status is added.
 */
describe("pre-order payment machine", () => {
  it("covers every payment status in the contract", () => {
    expect(Object.keys(PRE_ORDER_PAYMENT_TRANSITIONS).sort()).toEqual(
      [...preOrderPaymentStatuses].sort(),
    );
  });

  it("never allows a transition outside the map, or to itself", () => {
    for (const [status, allowed] of Object.entries(PRE_ORDER_PAYMENT_TRANSITIONS)) {
      expect(allowed).not.toContain(status);
      for (const next of allowed) expect(preOrderPaymentStatuses).toContain(next);
    }
  });

  it("lets an unverified payment be accepted or rejected", () => {
    expect(canTransitionPayment("PENDING", "ACCEPTED")).toBe(true);
    expect(canTransitionPayment("PENDING", "REJECTED")).toBe(true);
  });

  it("never un-accepts a payment — the customer has already been told", () => {
    expect(canTransitionPayment("ACCEPTED", "PENDING")).toBe(false);
    expect(canTransitionPayment("ACCEPTED", "REJECTED")).toBe(false);
    // Money can still go back out, which is the only move left.
    expect(canTransitionPayment("ACCEPTED", "REFUNDED")).toBe(true);
  });

  it("treats REJECTED and REFUNDED as terminal", () => {
    expect(isPaymentTerminal("REJECTED")).toBe(true);
    expect(isPaymentTerminal("REFUNDED")).toBe(true);
    expect(isPaymentTerminal("PENDING")).toBe(false);
  });
});

describe("pre-order fulfilment machine", () => {
  it("covers every fulfilment status in the contract", () => {
    expect(Object.keys(PRE_ORDER_FULFILLMENT_TRANSITIONS).sort()).toEqual(
      [...preOrderFulfillmentStatuses].sort(),
    );
  });

  it("never allows a transition outside the map, or to itself", () => {
    for (const [status, allowed] of Object.entries(PRE_ORDER_FULFILLMENT_TRANSITIONS)) {
      expect(allowed).not.toContain(status);
      for (const next of allowed) expect(preOrderFulfillmentStatuses).toContain(next);
    }
  });

  it("cannot cancel once the parcel has left the building", () => {
    expect(canTransitionFulfillment("SHIPPED", "CANCELLED")).toBe(false);
    expect(canTransitionFulfillment("DELIVERED", "CANCELLED")).toBe(false);
    // Before dispatch it is always available.
    expect(canTransitionFulfillment("NOT_STARTED", "CANCELLED")).toBe(true);
    expect(canTransitionFulfillment("PROCESSING", "CANCELLED")).toBe(true);
  });

  it("treats DELIVERED and CANCELLED as terminal", () => {
    expect(isFulfillmentTerminal("DELIVERED")).toBe(true);
    expect(isFulfillmentTerminal("CANCELLED")).toBe(true);
    expect(isFulfillmentTerminal("NOT_STARTED")).toBe(false);
  });
});

describe("the rule that spans both tracks", () => {
  it("only lets fulfilment start once the payment is accepted", () => {
    expect(canStartFulfillment("ACCEPTED")).toBe(true);

    for (const status of preOrderPaymentStatuses.filter((s) => s !== "ACCEPTED")) {
      expect(canStartFulfillment(status)).toBe(false);
    }
  });
});

describe("derivePreOrderStatus", () => {
  it("answers PENDING before the payment has been looked at", () => {
    expect(derivePreOrderStatus("PENDING", "NOT_STARTED")).toBe("PENDING");
  });

  it("answers CONFIRMED once paid but before there is anything to ship", () => {
    // The state a pre-order lives in for months, and the reason the columns
    // were split: one column cannot say both of these things at once.
    expect(derivePreOrderStatus("ACCEPTED", "NOT_STARTED")).toBe("CONFIRMED");
  });

  it("prefers the fulfilment track once dispatch has started", () => {
    expect(derivePreOrderStatus("ACCEPTED", "PROCESSING")).toBe("PROCESSING");
    expect(derivePreOrderStatus("ACCEPTED", "SHIPPED")).toBe("SHIPPED");
    expect(derivePreOrderStatus("ACCEPTED", "DELIVERED")).toBe("DELIVERED");
  });

  it("reports a cancellation whatever else is true of the order", () => {
    for (const payment of preOrderPaymentStatuses) {
      expect(derivePreOrderStatus(payment, "CANCELLED")).toBe("CANCELLED");
    }
  });

  it("reports a rejected payment as REJECTED, and a refunded one as CANCELLED", () => {
    expect(derivePreOrderStatus("REJECTED", "NOT_STARTED")).toBe("REJECTED");
    expect(derivePreOrderStatus("REFUNDED", "NOT_STARTED")).toBe("CANCELLED");
  });

  it("never returns a status outside the contract's union", () => {
    for (const payment of preOrderPaymentStatuses) {
      for (const fulfillment of preOrderFulfillmentStatuses) {
        expect(preOrderStatuses).toContain(derivePreOrderStatus(payment, fulfillment));
      }
    }
  });
});
