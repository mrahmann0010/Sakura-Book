import { describe, expect, it } from "vitest";
import {
  ORDER_STATUS_TRANSITIONS,
  STOCK_HELD_STATUSES,
  canTransition,
  isTerminal,
} from "../../src/orders/order-status.machine";
import { orderStatuses } from "@sakura/contracts";

/**
 * The lifecycle, as a data structure.
 *
 * The point of the transition map is that "you cannot cancel a shipped order"
 * is a table rather than a scattering of `if`s, so these tests assert against
 * the table's *properties* wherever they can, not just against today's edges.
 * A property that holds for every status keeps holding when a status is added.
 */
describe("order status machine", () => {
  it("covers every status in the contract", () => {
    // The enum and the map are two lists that must not drift: a status added
    // to the contract with no entry here would make canTransition throw on an
    // undefined lookup, at whatever hour the first such order was placed.
    expect(Object.keys(ORDER_STATUS_TRANSITIONS).sort()).toEqual([...orderStatuses].sort());
  });

  it("never allows a transition to a status outside the map", () => {
    for (const [, allowed] of Object.entries(ORDER_STATUS_TRANSITIONS)) {
      for (const next of allowed) {
        expect(orderStatuses).toContain(next);
      }
    }
  });

  it("never allows a status to transition to itself", () => {
    // Re-entry would double-count anything keyed on entering a status —
    // notably the units_sold rollup, which fires on entry to PAYMENT_CONFIRMED
    // and adds the order's quantities each time.
    for (const [status, allowed] of Object.entries(ORDER_STATUS_TRANSITIONS)) {
      expect(allowed).not.toContain(status);
    }
  });

  it("treats CANCELLED and REFUNDED as terminal", () => {
    expect(isTerminal("CANCELLED")).toBe(true);
    expect(isTerminal("REFUNDED")).toBe(true);
  });

  it("refuses to cancel a shipped order", () => {
    expect(canTransition("SHIPPED", "CANCELLED")).toBe(false);
  });

  it("refuses to move backwards through fulfilment", () => {
    expect(canTransition("DELIVERED", "SHIPPED")).toBe(false);
    expect(canTransition("SHIPPED", "PROCESSING")).toBe(false);
  });

  it("allows the happy path end to end", () => {
    const path = ["PENDING", "PAYMENT_CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED"] as const;

    for (let index = 0; index < path.length - 1; index += 1) {
      expect(canTransition(path[index], path[index + 1])).toBe(true);
    }
  });

  it("lists only non-terminal statuses as holding stock", () => {
    // STOCK_HELD_STATUSES drives whether cancelling returns stock. A terminal
    // status in that list would mean inventory is credited back for an order
    // that can never be cancelled — i.e. never, or twice.
    for (const status of STOCK_HELD_STATUSES) {
      expect(isTerminal(status)).toBe(false);
    }
  });

  it("can reach a terminal status from every stock-holding status", () => {
    // The other half of the same rule: stock held by an order that cannot be
    // cancelled or refunded is stock that can never come back.
    for (const status of STOCK_HELD_STATUSES) {
      const allowed = ORDER_STATUS_TRANSITIONS[status];

      expect(allowed.some((next) => isTerminal(next))).toBe(true);
    }
  });
});
