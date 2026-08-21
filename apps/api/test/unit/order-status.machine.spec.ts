import { describe, expect, it } from "vitest";
import {
  ORDER_STATUS_TRANSITIONS,
  STOCK_HELD_STATUSES,
  canTransition,
  isTerminal,
  releasesStock,
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

/**
 * When copies go back on the shelf.
 *
 * This rule is applied inside `OrdersService.transition`, so it is the thing
 * standing between a cancelled order and inventory that silently vanishes.
 * It is derived from STOCK_HELD_STATUSES and `isTerminal` rather than being a
 * third hand-maintained list, and these tests pin the derivation — including
 * the case that reads wrong at first glance.
 */
describe("releasesStock", () => {
  it("returns copies for an order cancelled before dispatch", () => {
    for (const from of STOCK_HELD_STATUSES) {
      expect(releasesStock(from, "CANCELLED")).toBe(true);
    }
  });

  it("returns copies for an order refunded before dispatch", () => {
    // The case worth spelling out. "Refund" reads as "the goods are gone", and
    // for a shipped order it is — but an order paid for and refunded before
    // anyone picked it still has its copies on the shelf, and leaving them
    // decremented is stock the shop cannot sell and cannot see.
    expect(releasesStock("PAYMENT_CONFIRMED", "REFUNDED")).toBe(true);
  });

  it("does not return copies once the parcel has left", () => {
    // SHIPPED and DELIVERED are not stock-held: the copies left with the
    // courier. Crediting them back would invent inventory out of a refund.
    expect(releasesStock("SHIPPED", "REFUNDED")).toBe(false);
    expect(releasesStock("DELIVERED", "REFUNDED")).toBe(false);
  });

  it("does not fire on moves that are not the end of the line", () => {
    // Stock stays held while the order is still being worked on.
    expect(releasesStock("PENDING", "PAYMENT_CONFIRMED")).toBe(false);
    expect(releasesStock("PAYMENT_CONFIRMED", "PROCESSING")).toBe(false);
    expect(releasesStock("PROCESSING", "SHIPPED")).toBe(false);
  });

  it("never fires twice for one order, because terminal statuses are terminal", () => {
    // The guarantee that makes calling this inside `transition` safe: an order
    // cannot leave CANCELLED or REFUNDED, so stock cannot be credited a second
    // time by a subsequent move. If a terminal status ever gained an outgoing
    // transition, this is the test that would object.
    for (const from of ["CANCELLED", "REFUNDED"] as const) {
      expect(isTerminal(from)).toBe(true);

      for (const to of orderStatuses) {
        expect(releasesStock(from, to)).toBe(false);
      }
    }
  });

  it("agrees with the CANCELLED case for every REFUNDED case", () => {
    // `releasesStockOnCancel` on the admin detail response is computed against
    // CANCELLED alone and documented as answering for both. That claim is only
    // true while these two agree, so it is asserted rather than assumed.
    for (const from of orderStatuses) {
      expect(releasesStock(from, "REFUNDED")).toBe(releasesStock(from, "CANCELLED"));
    }
  });
});
