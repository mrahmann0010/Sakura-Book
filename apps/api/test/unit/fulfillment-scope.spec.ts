import { describe, expect, it } from "vitest";
import type { AdminOrderDetail, AdminOrderSummary } from "@sakura/contracts";
import {
  fulfillmentTransitionBlocker,
  isInFulfillmentScope,
  redactDetailForFulfillment,
  redactSummaryForFulfillment,
} from "../../src/admin/orders/fulfillment-scope";

/**
 * The packing table's scope, pinned as pure functions.
 *
 * Each rule here is a restriction, and a restriction that silently stops
 * applying breaks nothing a packer would notice — they simply see more. So the
 * cases below are mostly the refusals.
 */

const now = new Date("2026-09-19T12:00:00.000Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

describe("isInFulfillmentScope", () => {
  it("includes orders waiting to be packed and being packed", () => {
    expect(isInFulfillmentScope({ status: "PAYMENT_CONFIRMED", statusHistory: [] }, now)).toBe(
      true,
    );
    expect(isInFulfillmentScope({ status: "PROCESSING", statusHistory: [] }, now)).toBe(true);
  });

  it("excludes everything before payment is verified and after the courier has it", () => {
    for (const status of ["PENDING", "DELIVERED", "CANCELLED", "REFUNDED"] as const) {
      expect(isInFulfillmentScope({ status, statusHistory: [] }, now)).toBe(false);
    }
  });

  it("includes a shipped order only inside the trailing window", () => {
    const shipped = (at: Date) => ({
      status: "SHIPPED" as const,
      statusHistory: [{ status: "SHIPPED", createdAt: at }],
    });

    expect(isInFulfillmentScope(shipped(daysAgo(1)), now)).toBe(true);
    expect(isInFulfillmentScope(shipped(daysAgo(4)), now)).toBe(false);
  });

  it("does not let a recent unrelated history row stand in for the shipment", () => {
    // Only the SHIPPED entry counts. An order shipped weeks ago must not come
    // back into view because something else happened to it yesterday.
    const row = {
      status: "SHIPPED" as const,
      statusHistory: [
        { status: "SHIPPED", createdAt: daysAgo(20) },
        { status: "PROCESSING", createdAt: daysAgo(1) },
      ],
    };

    expect(isInFulfillmentScope(row, now)).toBe(false);
  });
});

describe("fulfillmentTransitionBlocker", () => {
  it("allows the two forward moves, one step or both at once", () => {
    expect(fulfillmentTransitionBlocker("PAYMENT_CONFIRMED", ["PROCESSING"], undefined)).toBeNull();
    expect(fulfillmentTransitionBlocker("PROCESSING", ["SHIPPED"], undefined)).toBeNull();
    expect(
      fulfillmentTransitionBlocker("PAYMENT_CONFIRMED", ["PROCESSING", "SHIPPED"], undefined),
    ).toBeNull();
  });

  it("refuses cancelling, refunding, delivering and going backward", () => {
    for (const target of ["CANCELLED", "REFUNDED", "DELIVERED", "PENDING"] as const) {
      expect(fulfillmentTransitionBlocker("PROCESSING", [target], undefined)).not.toBeNull();
    }
  });

  it("refuses a route that passes through a status outside the packer's two", () => {
    expect(
      fulfillmentTransitionBlocker("PROCESSING", ["SHIPPED", "DELIVERED"], undefined),
    ).not.toBeNull();
  });

  it("refuses to move an order that is not on the packing table", () => {
    expect(
      fulfillmentTransitionBlocker("PENDING", ["PAYMENT_CONFIRMED"], undefined),
    ).not.toBeNull();
    expect(fulfillmentTransitionBlocker("SHIPPED", ["DELIVERED"], undefined)).not.toBeNull();
  });

  it("refuses an empty route rather than treating it as a no-op", () => {
    expect(fulfillmentTransitionBlocker("PROCESSING", [], undefined)).not.toBeNull();
  });

  it("refuses a duplicate-receipt override", () => {
    expect(
      fulfillmentTransitionBlocker(
        "PROCESSING",
        ["SHIPPED"],
        "customer paid twice from one wallet",
      ),
    ).not.toBeNull();
  });
});

describe("redaction", () => {
  const summary: AdminOrderSummary = {
    orderNumber: "NB-40718",
    status: "PAYMENT_CONFIRMED",
    placedAt: now.toISOString(),
    customerName: "Rahim",
    customerEmail: "rahim@example.com",
    customerPhone: "01700000000",
    region: "Dhaka",
    city: "Dhaka",
    paymentMethod: "cash-on-delivery",
    paymentProvider: "bkash",
    currency: "BDT",
    totalCents: 120000,
    lineCount: 1,
    itemCount: 2,
    hasInternalNote: false,
    receipt: { state: "DUPLICATE", claimedByOrderNumber: "NB-40001" },
    verification: {
      outcome: "MATCHED",
      checkedAt: now.toISOString(),
      checkedByEmail: "owner@shop.test",
    },
  } as AdminOrderSummary;

  it("keeps what a parcel needs, including the amount the courier collects", () => {
    const redacted = redactSummaryForFulfillment(summary);

    expect(redacted.customerName).toBe("Rahim");
    expect(redacted.customerPhone).toBe("01700000000");
    expect(redacted.totalCents).toBe(120000);
    expect(redacted.paymentMethod).toBe("cash-on-delivery");
  });

  it("blanks the payment side and the email", () => {
    const redacted = redactSummaryForFulfillment(summary);

    expect(redacted.customerEmail).toBe("");
    expect(redacted.paymentProvider).toBeNull();
    expect(redacted.receipt).toEqual({ state: "NOT_APPLICABLE", claimedByOrderNumber: null });
    expect(redacted.verification).toEqual({
      outcome: "UNCHECKED",
      checkedAt: null,
      checkedByEmail: null,
    });
  });

  it("strips payments from the detail and narrows its buttons to forward moves", () => {
    const detail = {
      ...summary,
      status: "PROCESSING",
      paymentSenderNumber: "01800000000",
      senderNumber: "01800000000",
      transactionId: "TRX123",
      payments: [
        {
          provider: "bkash",
          referenceId: "TRX123",
          amountCents: 120000,
          status: "SUCCEEDED",
          recordedAt: now.toISOString(),
        },
      ],
      allowedTransitions: ["SHIPPED", "CANCELLED", "REFUNDED"],
      reopen: { allowed: true, blockedReason: null },
      verifications: [{}],
    } as unknown as AdminOrderDetail;

    const redacted = redactDetailForFulfillment(detail);

    expect(redacted.transactionId).toBeNull();
    expect(redacted.senderNumber).toBeNull();
    expect(redacted.paymentSenderNumber).toBeNull();
    expect(redacted.payments).toEqual([]);
    expect(redacted.verifications).toEqual([]);
    expect(redacted.allowedTransitions).toEqual(["SHIPPED"]);
    expect(redacted.reopen.allowed).toBe(false);
  });
});
