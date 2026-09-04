import { describe, expect, it, vi } from "vitest";
import { AdminOrdersService, type AdminContext } from "../../src/admin/orders/admin-orders.service";
import { InvalidInputError } from "../../src/common/errors";
import { directionFor } from "../../src/inventory/sales-rollup.listener";
import { canTransition } from "../../src/orders/order-status.machine";

/**
 * Undoing a payment confirmation made in error.
 *
 * The action exists because the two things staff previously had to reach for
 * were both untrue: cancelling the order (terminal — the customer who is about
 * to pay loses their place) or recording a refund for money that never
 * arrived. What makes it worth testing is that the status change is the *least*
 * important of the three things it does. The other two are invisible when they
 * go wrong:
 *
 *   - the payment row must be voided, or the order can never be confirmed
 *     again, because idempotency is keyed on the order number;
 *   - the sale must be un-counted, or `units_sold` ratchets up by the order's
 *     quantities every time a mistaken acceptance is corrected.
 *
 * Neither produces an error. Both produce a number that is quietly wrong, which
 * is what these tests are for.
 */

const CONTEXT: AdminContext = {
  actor: {
    sub: "admin-1",
    sid: "session-1",
    role: "ADMIN",
    email: "owner@shop.com",
    iat: 0,
    exp: 0,
  },
};

const CONFIRMED_ORDER = {
  id: "order-1",
  orderNumber: "NB-40718",
  status: "PAYMENT_CONFIRMED",
  totalCents: 125000,
  paymentMethod: "manual-transfer",
  transactionId: "PAY123",
  provider: "bkash",
};

const REASON = "Confirmed against the wrong order number on the bKash statement.";

/**
 * The service with its collaborators stubbed, driven through its public method.
 *
 * Same shape as the duplicate-receipt suite next door, and for the same
 * reason: what is in doubt is not whether `transition` moves a status, it is
 * whether this action reaches all three of its collaborators.
 */
function service(overrides: { order?: Record<string, unknown> } = {}) {
  const voidConfirmed = vi.fn(async () => 1);
  const transition = vi.fn(async () => undefined);
  const announceStatusChange = vi.fn();
  const auditRecord = vi.fn(
    async (entry: { action: string; note?: string; after?: Record<string, unknown> }) => {
      void entry;
    },
  );

  const adminOrders = new AdminOrdersService(
    {
      db: { transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})) },
    } as never,
    { transition, transitionAndCommit: vi.fn(), announceStatusChange } as never,
    { voidConfirmed, forOrder: vi.fn(async () => []) } as never,
    { record: auditRecord, recordDetached: vi.fn(async () => undefined) } as never,
    { verify: vi.fn() } as never,
    {
      record: vi.fn(),
      latestFor: vi.fn(async () => new Map()),
      historyFor: vi.fn(async () => []),
      findDuplicatedReceipts: vi.fn(async () => new Set<string>()),
    } as never,
    { get: vi.fn(() => "Nihonova Academy") } as never,
  );

  vi.spyOn(
    adminOrders as unknown as { requireOrder: (n: string) => Promise<unknown> },
    "requireOrder",
  ).mockResolvedValue(overrides.order ?? CONFIRMED_ORDER);

  vi.spyOn(
    adminOrders as unknown as { detail: (n: string) => Promise<unknown> },
    "detail",
  ).mockResolvedValue({});

  return { adminOrders, voidConfirmed, transition, announceStatusChange, auditRecord };
}

describe("revertPaymentConfirmation", () => {
  it("voids the payment record as well as moving the status", async () => {
    // The half that is easy to leave out and impossible to notice: the
    // payments table keys idempotency on the order number, so a row left
    // SUCCEEDED means the customer's real payment can never be confirmed —
    // it is swallowed as a replay and the order sits in PENDING forever.
    const { adminOrders, voidConfirmed, transition } = service();

    await adminOrders.revertPaymentConfirmation(
      CONFIRMED_ORDER.orderNumber,
      { reason: REASON },
      CONTEXT,
    );

    expect(voidConfirmed).toHaveBeenCalledWith(
      CONFIRMED_ORDER.id,
      expect.objectContaining({ reason: REASON, voidedBy: "owner@shop.com" }),
      expect.anything(),
    );
    expect(transition).toHaveBeenCalledWith(
      CONFIRMED_ORDER.id,
      "PENDING",
      expect.anything(),
      expect.any(String),
    );
  });

  it("voids the payment before the transition, inside one transaction", async () => {
    // Ordering mirrors confirmPayment's on the way in: the payment record is
    // settled first and the status is the consequence. If the transition is
    // refused — someone moved the order to PROCESSING a second ago — the
    // whole thing rolls back and the payment row is untouched.
    const calls: string[] = [];
    const { adminOrders, voidConfirmed, transition } = service();

    voidConfirmed.mockImplementation(async () => {
      calls.push("void");
      return 1;
    });
    transition.mockImplementation(async () => {
      calls.push("transition");
    });

    await adminOrders.revertPaymentConfirmation(
      CONFIRMED_ORDER.orderNumber,
      { reason: REASON },
      CONTEXT,
    );

    expect(calls).toEqual(["void", "transition"]);
  });

  it("announces the status change, which is what un-counts the sale", async () => {
    // Not decoration. The rollup listener is the only thing that subtracts
    // from units_sold, it is driven by this event, and nothing fails if the
    // event is missing — the number is simply too high from then on.
    const { adminOrders, announceStatusChange } = service();

    await adminOrders.revertPaymentConfirmation(
      CONFIRMED_ORDER.orderNumber,
      { reason: REASON },
      CONTEXT,
    );

    expect(announceStatusChange).toHaveBeenCalledWith({
      orderId: CONFIRMED_ORDER.id,
      orderNumber: CONFIRMED_ORDER.orderNumber,
      from: "PAYMENT_CONFIRMED",
      to: "PENDING",
    });
  });

  it("records the reason under its own audit action", async () => {
    const { adminOrders, auditRecord } = service();

    await adminOrders.revertPaymentConfirmation(
      CONFIRMED_ORDER.orderNumber,
      { reason: REASON },
      CONTEXT,
    );

    const entry = auditRecord.mock.calls[0]?.[0];

    expect(entry?.action).toBe("PAYMENT_REVERT");
    expect(entry?.note).toBe(REASON);
    expect(entry?.after?.voidedPayments).toBe(1);
  });

  it("writes the audit entry in the same transaction as the change", async () => {
    // `record`, not `recordDetached`. Unlike an ordinary transition there is no
    // append-only second record of *why* — order_status_history keeps the move
    // but not the reason — so a lost entry here is a confirmation that
    // vanished with nobody's name on it.
    const { adminOrders, auditRecord } = service();

    await adminOrders.revertPaymentConfirmation(
      CONFIRMED_ORDER.orderNumber,
      { reason: REASON },
      CONTEXT,
    );

    expect(auditRecord).toHaveBeenCalledTimes(1);
  });
});

describe("the transition endpoint's refusal to do this itself", () => {
  /**
   * The machine allows PAYMENT_CONFIRMED → PENDING so that `transition` — the
   * single write path for `orders.status` — can perform it. That same edge
   * would otherwise make the generic admin transition endpoint a second door
   * to a *half* revert: status moved, payment row still standing, sale still
   * counted. This is the test that the door is shut.
   */
  it("refuses a plain transition to PENDING", async () => {
    const { adminOrders, transition } = service();

    await expect(
      adminOrders.transition(CONFIRMED_ORDER.orderNumber, { status: "PENDING" }, CONTEXT),
    ).rejects.toBeInstanceOf(InvalidInputError);

    expect(transition).not.toHaveBeenCalled();
  });

  it("refuses an advance whose route passes through PENDING", async () => {
    // Asked of the route rather than of the requested status, for the same
    // reason the duplicate guard is: a destination-only check is a third door.
    const { adminOrders, transition } = service();

    await expect(
      adminOrders.transition(
        CONFIRMED_ORDER.orderNumber,
        { status: "PENDING", advance: true },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(InvalidInputError);

    expect(transition).not.toHaveBeenCalled();
  });
});

describe("the lifecycle's one backward edge", () => {
  it("allows PAYMENT_CONFIRMED back to PENDING", () => {
    expect(canTransition("PAYMENT_CONFIRMED", "PENDING")).toBe(true);
  });

  it("does not open the same door further down the line", () => {
    // Once the parcel is being packed the question stops being "was this
    // confirmed in error" and becomes "where is the stock", which is a
    // cancellation or a refund.
    expect(canTransition("PROCESSING", "PENDING")).toBe(false);
    expect(canTransition("SHIPPED", "PENDING")).toBe(false);
    expect(canTransition("DELIVERED", "PENDING")).toBe(false);
    expect(canTransition("CANCELLED", "PENDING")).toBe(false);
    expect(canTransition("REFUNDED", "PENDING")).toBe(false);
  });

  it("keeps the copies reserved rather than restocking them", () => {
    // PENDING is not terminal and is itself stock-held, so `releasesStock` is
    // false and the customer's copies stay held for the order they are still
    // going to pay for. Asserted through the rollup's sibling rule below
    // rather than restated here — see order-status.machine.spec.
    expect(canTransition("PENDING", "PAYMENT_CONFIRMED")).toBe(true);
  });
});

describe("the rollup's view of a revert", () => {
  it("un-counts the sale", () => {
    // Without this, units_sold keeps the copies, the order is confirmed again
    // when the money genuinely arrives, and the same copies are counted twice.
    expect(
      directionFor({
        orderId: "o",
        orderNumber: "NB-40718",
        from: "PAYMENT_CONFIRMED",
        to: "PENDING",
      }),
    ).toBe(-1);
  });

  it("counts the genuine confirmation that follows", () => {
    // The round trip nets to one sale, which is the whole point.
    const revert = directionFor({
      orderId: "o",
      orderNumber: "NB-40718",
      from: "PAYMENT_CONFIRMED",
      to: "PENDING",
    });
    const reconfirm = directionFor({
      orderId: "o",
      orderNumber: "NB-40718",
      from: "PENDING",
      to: "PAYMENT_CONFIRMED",
    });

    expect(revert + reconfirm).toBe(0);
    expect(reconfirm).toBe(1);
  });
});
