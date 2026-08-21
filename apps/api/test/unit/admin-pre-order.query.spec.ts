import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { adminPreOrderQuerySchema } from "@sakura/contracts";
import {
  adminPreOrderFilters,
  adminPreOrderOrder,
} from "../../src/admin/pre-order/admin-pre-order.query";

/**
 * The pre-order queue's filters and sort.
 *
 * Same shape as admin-order.query.spec.ts, guarding the same silent failures.
 * What is new here is that there are two status columns, and that the useful
 * queries name both — so the tests that matter are the ones asserting they
 * compose rather than replace each other.
 */
describe("adminPreOrderQuerySchema", () => {
  it("accepts a single status of either track as a one-element array", () => {
    expect(adminPreOrderQuerySchema.parse({ paymentStatus: "PENDING" }).paymentStatus).toEqual([
      "PENDING",
    ]);
    expect(
      adminPreOrderQuerySchema.parse({ fulfillmentStatus: "SHIPPED" }).fulfillmentStatus,
    ).toEqual(["SHIPPED"]);
  });

  it("keeps the two tracks' vocabularies apart", () => {
    // NOT_STARTED is a delivery state and ACCEPTED is a payment one. A schema
    // that took either on either column would let the panel build a filter
    // that silently matches nothing.
    expect(() => adminPreOrderQuerySchema.parse({ paymentStatus: "NOT_STARTED" })).toThrow();
    expect(() => adminPreOrderQuerySchema.parse({ fulfillmentStatus: "ACCEPTED" })).toThrow();
  });

  it("defaults to newest-first, because the queue is a work list", () => {
    expect(adminPreOrderQuerySchema.parse({}).sort).toBe("recent");
  });

  it("caps page size", () => {
    expect(() => adminPreOrderQuerySchema.parse({ pageSize: 5000 })).toThrow();
  });
});

/** See the note on the same helper in admin-order.query.spec.ts. */
function render(fragment: SQL | undefined): { sql: string; params: unknown[] } {
  const query = new PgDialect().sqlToQuery(fragment!);

  return { sql: query.sql, params: query.params };
}

describe("adminPreOrderFilters", () => {
  const query = (overrides: Record<string, unknown> = {}) =>
    adminPreOrderQuerySchema.parse(overrides);

  it("applies no constraint when nothing is filtered", () => {
    expect(adminPreOrderFilters(query())).toBeUndefined();
  });

  it("ANDs the two tracks, which is what makes the dispatch list expressible", () => {
    // "Paid, waiting on the print run" — the list worked through the day the
    // copies arrive. If these ORed, it would also return every unpaid order.
    const { sql } = render(
      adminPreOrderFilters(
        query({ paymentStatus: "ACCEPTED", fulfillmentStatus: ["NOT_STARTED", "PROCESSING"] }),
      ),
    );

    expect(sql).toContain("payment_status");
    expect(sql).toContain("fulfillment_status");
    expect(sql).toContain(" and ");
  });

  it("filters on one track without constraining the other", () => {
    const { sql } = render(adminPreOrderFilters(query({ paymentStatus: "PENDING" })));

    expect(sql).toContain("payment_status");
    expect(sql).not.toContain("fulfillment_status");
  });

  it("escapes wildcards typed into the search box", () => {
    expect(render(adminPreOrderFilters(query({ q: "100%" }))).params).toContain("%100\\%%");
  });

  it("anchors the order number and escapes an underscore", () => {
    expect(render(adminPreOrderFilters(query({ q: "MG_40718" }))).params).toContain("MG\\_40718%");
  });

  it("includes the whole of the last day in a date range", () => {
    const { params } = render(adminPreOrderFilters(query({ placedTo: "2026-08-20" })));

    // Bound as the driver would send it — the dialect has already rendered
    // the Date to a timestamp string by this point.
    expect(params).toContain("2026-08-20T23:59:59.999Z");
  });
});

describe("adminPreOrderOrder", () => {
  it("gives every sort a stable tiebreak, so pagination cannot drop rows", () => {
    // Two pre-orders placed in the same second is routine on launch day, and a
    // queue that silently omits one is a pre-order nobody ever fulfils.
    for (const sort of ["recent", "oldest", "total-desc"] as const) {
      expect(adminPreOrderOrder(sort)).toHaveLength(2);
    }
  });
});
