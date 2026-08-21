import { describe, expect, it } from "vitest";
import { orderStatuses } from "@sakura/contracts";
import { COUNTED_STATUSES } from "../../src/inventory/units-sold-reconciler";
import { directionFor } from "../../src/inventory/sales-rollup.listener";
import { ORDER_STATUS_TRANSITIONS } from "../../src/orders/order-status.machine";
import type { OrderStatusChangedEvent } from "../../src/orders/order.events";

/**
 * The reconciler and the rollup listener express one rule two ways.
 *
 * The listener works in deltas — +1 when an order is confirmed, -1 when a
 * counted order is cancelled. The reconciler works in totals — sum the items
 * of every order in a counted status. They can only ever agree if "counted"
 * means the same thing in both, and if it stops meaning the same thing the
 * failure is not a wrong number, it is a *fight*: reconciliation writes the
 * total, the next event nudges it back, and each run undoes the other's
 * answer forever.
 *
 * These tests are the thing standing between that and a code review.
 */
const event = (from: string, to: string): OrderStatusChangedEvent =>
  ({ orderId: "o", orderNumber: "MG-1", from, to }) as OrderStatusChangedEvent;

describe("units_sold counted statuses", () => {
  it("names only statuses the lifecycle actually has", () => {
    for (const status of COUNTED_STATUSES) {
      expect(orderStatuses).toContain(status);
    }
  });

  it("counts exactly the statuses an order reaches with a net +1 from the listener", () => {
    /**
     * Derived by walking the lifecycle rather than by comparing against a
     * second hardcoded list, which would only prove the two lists match today.
     *
     * For each status, take a real path an order could travel from PENDING,
     * run every edge past the listener, and sum the deltas. A net of +1 means
     * an order sitting in that status has had its sale counted and not
     * reversed — which is precisely what the reconciler's totalling query must
     * agree with.
     *
     * This catches the case the obvious test misses: REFUNDED is counted, and
     * not because anything increments on arrival — the listener counted it at
     * PAYMENT_CONFIRMED and deliberately does not reverse it on the way out.
     */
    const countedByListener = orderStatuses.filter((status) => netForPath(status) === 1);

    expect([...COUNTED_STATUSES].sort()).toEqual([...countedByListener].sort());
  });

  it("excludes CANCELLED, which the listener reverses", () => {
    expect(COUNTED_STATUSES).not.toContain("CANCELLED");
  });

  it("excludes PENDING, which was never counted", () => {
    // Cancelling straight out of PENDING must change nothing — subtracting
    // there would drive the counter negative.
    expect(COUNTED_STATUSES).not.toContain("PENDING");
    expect(directionFor(event("PENDING", "CANCELLED"))).toBe(0);
  });

  it("includes REFUNDED, matching the listener's decision not to reverse it", () => {
    // Worth disagreeing with — an order refunded before dispatch never left
    // the building — but it must be changed in both places at once, and this
    // assertion is what makes changing only one of them fail.
    expect(COUNTED_STATUSES).toContain("REFUNDED");
    expect(directionFor(event("DELIVERED", "REFUNDED"))).toBe(0);
  });
});

/**
 * The listener's net effect on `units_sold` for an order that travelled from
 * PENDING to `target`, over the shortest legal path.
 *
 * Shortest is enough: the map has no cycle that changes the count, because
 * both terminal statuses are terminal and there is exactly one increment and
 * one reversal edge in the whole graph.
 */
function netForPath(target: string): number {
  const path = shortestPath("PENDING", target);

  if (!path) return 0;

  let net = 0;

  for (let index = 0; index + 1 < path.length; index++) {
    net += directionFor(event(path[index], path[index + 1]));
  }

  return net;
}

function shortestPath(from: string, to: string): string[] | undefined {
  if (from === to) return [from];

  const queue: string[][] = [[from]];
  const seen = new Set([from]);

  while (queue.length > 0) {
    const path = queue.shift()!;
    const next = ORDER_STATUS_TRANSITIONS[path.at(-1) as keyof typeof ORDER_STATUS_TRANSITIONS];

    for (const status of next) {
      if (status === to) return [...path, status];
      if (seen.has(status)) continue;

      seen.add(status);
      queue.push([...path, status]);
    }
  }

  return undefined;
}
