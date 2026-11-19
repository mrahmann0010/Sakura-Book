import { describe, expect, it } from "vitest";
import {
  orderPaymentStatuses,
  orderStatuses,
  type OrderPaymentStatus,
  type PaymentMethod,
} from "@sakura/contracts";
import { canTransition, type OrderStatus } from "../../src/orders/order-status.machine";
import { nextPaymentStatus } from "../../src/orders/payment-status";
import { orderPaymentStatusEnum } from "../../src/db/schema";

const COD: PaymentMethod = "cash-on-delivery";
const TRANSFER: PaymentMethod = "manual-transfer";

/** Run a status history through the rule, the way `transition` would. */
function replay(method: PaymentMethod, history: OrderStatus[]): OrderPaymentStatus {
  let payment: OrderPaymentStatus = "UNPAID";

  for (let i = 1; i < history.length; i++) {
    const from = history[i - 1];
    const to = history[i];

    // Every step must be one the machine allows, or the case is describing an
    // order that cannot exist. The revert edge is in the machine; reopening
    // (CANCELLED → PENDING) is not, and is not a payment event either.
    expect(canTransition(from, to), `${from} → ${to}`).toBe(true);

    payment = nextPaymentStatus({ method, current: payment, from, to });
  }

  return payment;
}

describe("payment status rule", () => {
  it("database enum holds exactly the contract's values", () => {
    expect([...orderPaymentStatusEnum.enumValues]).toEqual([...orderPaymentStatuses]);
  });

  it("prepaid: confirming the transfer means paid", () => {
    expect(
      nextPaymentStatus({ method: TRANSFER, current: "UNPAID", from: "PENDING", to: "PAYMENT_CONFIRMED" }),
    ).toBe("PAID");
  });

  it("cash on delivery: accepting the order is not payment", () => {
    // The case the single status field got wrong: for COD this move means
    // "accepted for fulfilment", and no money has changed hands.
    expect(
      nextPaymentStatus({ method: COD, current: "UNPAID", from: "PENDING", to: "PAYMENT_CONFIRMED" }),
    ).toBe("UNPAID");
  });

  it("cash on delivery: delivery means the courier collected, not that the shop was paid", () => {
    expect(
      nextPaymentStatus({ method: COD, current: "UNPAID", from: "SHIPPED", to: "DELIVERED" }),
    ).toBe("COLLECTED");
  });

  it("prepaid: delivery does not change a paid order", () => {
    expect(
      nextPaymentStatus({ method: TRANSFER, current: "PAID", from: "SHIPPED", to: "DELIVERED" }),
    ).toBe("PAID");
  });

  it("reverting a confirmation means no money arrived, whatever the method", () => {
    for (const method of [TRANSFER, COD]) {
      expect(
        nextPaymentStatus({ method, current: "PAID", from: "PAYMENT_CONFIRMED", to: "PENDING" }),
      ).toBe("UNPAID");
    }
  });

  it("a refund is a refund, whatever the method and wherever it starts", () => {
    for (const method of [TRANSFER, COD]) {
      for (const from of orderStatuses) {
        if (!canTransition(from, "REFUNDED")) continue;

        expect(
          nextPaymentStatus({ method, current: "PAID", from, to: "REFUNDED" }),
        ).toBe("REFUNDED");
      }
    }
  });

  it("a prepaid order cancelled after payment stays paid — a refund is still owed", () => {
    expect(
      nextPaymentStatus({ method: TRANSFER, current: "PAID", from: "PROCESSING", to: "CANCELLED" }),
    ).toBe("PAID");
  });

  it("packing and shipping never move money", () => {
    for (const method of [TRANSFER, COD]) {
      for (const current of orderPaymentStatuses) {
        expect(nextPaymentStatus({ method, current, from: "PAYMENT_CONFIRMED", to: "PROCESSING" })).toBe(current);
        expect(nextPaymentStatus({ method, current, from: "PROCESSING", to: "SHIPPED" })).toBe(current);
      }
    }
  });

  /**
   * The same eleven histories migration 0047's backfill was run against on a
   * real Postgres before it shipped. Replaying them through the rule here
   * asserts the SQL backfill and the TypeScript rule agree: an existing order
   * gets the payment status it would have had if the column had always
   * existed.
   */
  describe("agrees with the 0047 backfill", () => {
    const cases: [string, PaymentMethod, OrderStatus[], OrderPaymentStatus][] = [
      ["prepaid, waiting", TRANSFER, ["PENDING"], "UNPAID"],
      ["prepaid, confirmed", TRANSFER, ["PENDING", "PAYMENT_CONFIRMED"], "PAID"],
      ["prepaid, delivered", TRANSFER, ["PENDING", "PAYMENT_CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED"], "PAID"],
      ["prepaid, refunded", TRANSFER, ["PENDING", "PAYMENT_CONFIRMED", "REFUNDED"], "REFUNDED"],
      ["COD, packing", COD, ["PENDING", "PAYMENT_CONFIRMED", "PROCESSING"], "UNPAID"],
      ["COD, delivered", COD, ["PENDING", "PAYMENT_CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED"], "COLLECTED"],
      ["prepaid, cancelled before payment", TRANSFER, ["PENDING", "CANCELLED"], "UNPAID"],
      ["prepaid, cancelled after payment", TRANSFER, ["PENDING", "PAYMENT_CONFIRMED", "CANCELLED"], "PAID"],
      ["prepaid, cancelled while packing", TRANSFER, ["PENDING", "PAYMENT_CONFIRMED", "PROCESSING", "CANCELLED"], "PAID"],
      ["prepaid, reverted then cancelled", TRANSFER, ["PENDING", "PAYMENT_CONFIRMED", "PENDING", "CANCELLED"], "UNPAID"],
      ["COD, cancelled after acceptance", COD, ["PENDING", "PAYMENT_CONFIRMED", "CANCELLED"], "UNPAID"],
    ];

    for (const [name, method, history, expected] of cases) {
      it(name, () => {
        expect(replay(method, history)).toBe(expected);
      });
    }
  });
});
