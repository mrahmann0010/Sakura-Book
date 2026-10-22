import { normaliseBdPhone } from "@sakura/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { heldClaimOf } from "../../src/admin/orders/admin-order.mapper";
import {
  PaymentClaimRefusedError,
  PaymentNotClaimedError,
} from "../../src/admin/orders/admin-order.errors";
import { AdminOrdersService, type AdminContext } from "../../src/admin/orders/admin-orders.service";
import { InvalidInputError } from "../../src/common/errors";
import { OrderAutoVerifyService } from "../../src/orders/order-auto-verify.service";
import { OrderPaymentClaimService, senderPhoneFor } from "../../src/orders/order-payment-claim.service";
import { toClaimRecord } from "../../src/orders/payment-verification-log.service";
import {
  FAST_RETRY_DELAYS_SECONDS,
  LATE_RETRY_INTERVAL_SECONDS,
  type ClaimOutcome,
} from "@project-sakura/pay";
import { claimedOutcome, createFakeGatewayClient } from "@project-sakura/pay/testing";

/**
 * The claim flow on the orders side, against @project-sakura/pay's fake
 * gateway client.
 *
 * The gateway's own behaviour (wire format, reason codes, retry schedule) is
 * tested in the package. What is pinned here is what the shop *does* with each answer: who gets
 * granted, who is left pending, which key is sent, when the worker comes
 * back, and which admin requests are refused.
 */

/* The local "is this receipt on another of our orders?" check, switchable per
   test. Mocked at its own module so the barrel the admin desk imports from
   sees the same mock. */
const local = vi.hoisted(() => ({ holder: undefined as unknown }));

vi.mock("../../src/orders/transaction-id-claim", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/orders/transaction-id-claim")>()),
  findTransactionIdClaim: vi.fn(async () => local.holder),
}));

const reread = vi.hoisted(() => ({ row: undefined as unknown }));

vi.mock("../../src/orders/order.query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/orders/order.query")>()),
  findOrder: vi.fn(async () => reread.row),
}));

beforeEach(() => {
  local.holder = undefined;
  reread.row = undefined;
});

type TestOrder = {
  id: string;
  orderNumber: string;
  status: string;
  paymentMethod: string;
  provider: string | null;
  transactionId: string | null;
  transactionIdNormalised: string | null;
  senderNumber: string | null;
  totalCents: number;
  paymentClaimKey: string | null;
  paymentClaimAttempts: number;
};

const order = (overrides: Partial<TestOrder> = {}): TestOrder => ({
  id: "order-1",
  orderNumber: "SB-10482",
  status: "PENDING",
  paymentMethod: "manual-transfer",
  provider: "bkash",
  transactionId: "8F3K2M9X01",
  transactionIdNormalised: "8F3K2M9X01",
  senderNumber: "01711111111",
  totalCents: 125_000,
  paymentClaimKey: "SB-10482:1",
  paymentClaimAttempts: 0,
  ...overrides,
});

const CLAIMED = claimedOutcome({
  platform: "bkash",
  paidPoisha: 130_000,
  overpaidPoisha: 5_000,
  claimedAt: new Date("2026-10-21T08:14:02.000Z"),
});

const OTHER_OUTCOMES: ClaimOutcome[] = [
  { outcome: "PENDING_ARRIVAL" },
  { outcome: "UNDERPAID", expectedPoisha: 125_000, paidPoisha: 90_000 },
  { outcome: "ALREADY_CLAIMED", claimedAt: null },
  { outcome: "RELEASED", releasedAt: null },
  { outcome: "REJECTED", rejection: "TOO_OLD", reason: "too old" },
  { outcome: "MISCONFIGURED", reason: "bad secret" },
  { outcome: "UNAVAILABLE", reason: "timeout" },
];

/** A real OrderPaymentClaimService over a fake gateway, db and log. */
function claimsWith(answers: ClaimOutcome[], options: { enabled?: boolean } = {}) {
  const gateway = createFakeGatewayClient(answers, { enabled: options.enabled ?? true });
  const updates: Record<string, unknown>[] = [];
  const db = {
    db: {
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: async () => {
            updates.push(values);
          },
        }),
      }),
    },
  };
  const log = {
    recordClaim: vi.fn(
      async (
        _orderId: string,
        outcome: ClaimOutcome,
        context: { transactionId: string; expectedCents: number; claimKey: string },
      ) => toClaimRecord(outcome, context),
    ),
  };

  const service = new OrderPaymentClaimService(db as never, gateway, log as never);

  return { service, gateway, updates, log };
}

const lastUpdate = (updates: Record<string, unknown>[]) => updates.at(-1) ?? {};

const secondsUntil = (value: unknown) =>
  Math.round(((value as Date).getTime() - Date.now()) / 1000);

describe("OrderPaymentClaimService", () => {
  it("claims with the order's stored key, the total in poisha and the order number", async () => {
    const { service, gateway } = claimsWith([CLAIMED]);

    await service.claim(order({ paymentClaimKey: "SB-10482:3" }) as never, null);

    expect(gateway.calls).toEqual([
      {
        trxId: "8F3K2M9X01",
        expectedPoisha: 125_000,
        idempotencyKey: "SB-10482:3",
        orderRef: "SB-10482",
        platform: "bkash",
        senderPhone: "01711111111",
      },
    ]);
  });

  it("leaves the payer's phone out only when none was typed", async () => {
    const { service, gateway } = claimsWith([CLAIMED]);

    await service.claim(order({ senderNumber: null }) as never, null);

    expect(gateway.calls[0]).toEqual(expect.objectContaining({ senderPhone: undefined }));
  });

  it("gives an order placed before keys existed the first key, and stores it", async () => {
    const { service, gateway, updates } = claimsWith([CLAIMED]);

    await service.claim(order({ paymentClaimKey: null }) as never, null);

    expect(gateway.calls[0]).toEqual(expect.objectContaining({ idempotencyKey: "SB-10482:1" }));
    expect(lastUpdate(updates)).toMatchObject({ paymentClaimKey: "SB-10482:1" });
  });

  it("reuses the same key on every retry", async () => {
    const { service, gateway } = claimsWith([{ outcome: "PENDING_ARRIVAL" }, CLAIMED]);

    await service.claim(order() as never, null);
    await service.claim(order({ paymentClaimAttempts: 1 }) as never, null);

    const keys = gateway.calls.map((call) => call.idempotencyKey);
    expect(keys).toEqual(["SB-10482:1", "SB-10482:1"]);
  });

  it("logs every attempt, with its key, against the order", async () => {
    const { service, log } = claimsWith([{ outcome: "PENDING_ARRIVAL" }]);

    await service.claim(order() as never, "staff@shop.com");

    expect(log.recordClaim).toHaveBeenCalledWith(
      "order-1",
      { outcome: "PENDING_ARRIVAL" },
      { transactionId: "8F3K2M9X01", expectedCents: 125_000, claimKey: "SB-10482:1" },
      "staff@shop.com",
    );
  });

  it("schedules a retry 5 seconds out when the SMS is not in yet", async () => {
    const { service, updates } = claimsWith([{ outcome: "PENDING_ARRIVAL" }]);

    await service.claim(order() as never, null);

    expect(lastUpdate(updates).paymentClaimAttempts).toBe(1);
    expect(secondsUntil(lastUpdate(updates).paymentClaimRetryAt)).toBe(5);
  });

  it("honours the gateway's retryAfter on a rate limit", async () => {
    const { service, updates } = claimsWith([
      { outcome: "UNAVAILABLE", reason: "rate limited", retryAfterSeconds: 45 },
    ]);

    await service.claim(order() as never, null);

    expect(secondsUntil(lastUpdate(updates).paymentClaimRetryAt)).toBe(45);
  });

  it("stops retrying once the fast schedule is used up", async () => {
    const { service, updates } = claimsWith([{ outcome: "PENDING_ARRIVAL" }]);

    await service.claim(
      order({ paymentClaimAttempts: FAST_RETRY_DELAYS_SECONDS.length }) as never,
      null,
    );

    expect(lastUpdate(updates).paymentClaimRetryAt).toBeNull();
  });

  it("schedules nothing while the gateway is not configured", async () => {
    const { service, updates } = claimsWith([{ outcome: "UNAVAILABLE", reason: "off" }], {
      enabled: false,
    });

    await service.claim(order() as never, null);

    expect(lastUpdate(updates).paymentClaimRetryAt).toBeNull();
  });

  it.each(OTHER_OUTCOMES.filter((o) => !["PENDING_ARRIVAL", "UNAVAILABLE"].includes(o.outcome)))(
    "does not retry a final answer: $outcome",
    async (outcome) => {
      const { service, updates } = claimsWith([outcome]);
      await service.claim(order() as never, null);
      expect(lastUpdate(updates).paymentClaimRetryAt).toBeNull();
    },
  );

  it("moves to a new key on RELEASED, without re-taking the payment by itself", async () => {
    const { service, gateway, updates } = claimsWith([{ outcome: "RELEASED", releasedAt: null }]);

    await service.claim(order() as never, null);

    expect(gateway.calls).toHaveLength(1);
    expect(lastUpdate(updates)).toMatchObject({
      paymentClaimKey: "SB-10482:2",
      paymentClaimAttempts: 0,
      paymentClaimRetryAt: null,
    });
  });

  it("re-claims under the new key straight away when staff ask", async () => {
    const { service, gateway } = claimsWith([{ outcome: "RELEASED", releasedAt: null }, CLAIMED]);

    const { outcome } = await service.claim(order() as never, "staff@shop.com", {
      retryReleased: true,
    });

    expect(outcome.outcome).toBe("CLAIMED");
    expect(gateway.calls[1]).toEqual(expect.objectContaining({ idempotencyKey: "SB-10482:2" }));
  });

  it("never asks the gateway about an order with no receipt", async () => {
    const { service, gateway } = claimsWith([]);

    const cod = order({ paymentMethod: "cash-on-delivery", transactionId: null });
    const { outcome } = await service.claim(cod as never, null);

    expect(outcome.outcome).toBe("MISCONFIGURED");
    expect(gateway.calls).toHaveLength(0);
  });
});

/** OrderAutoVerifyService over a real claim service and a fake gateway. */
function autoVerifyWith(answers: ClaimOutcome[], confirmManually = vi.fn(async () => ({ confirmed: true }))) {
  const claims = claimsWith(answers);
  const service = new OrderAutoVerifyService(
    { db: {} } as never,
    claims.service,
    { confirmManually } as never,
  );
  return { ...claims, service, confirmManually };
}

describe("OrderAutoVerifyService.settle", () => {
  it("grants a pending order on CLAIMED, for the order's own total", async () => {
    const { service, confirmManually } = autoVerifyWith([CLAIMED]);

    await expect(service.settle(order() as never)).resolves.toMatchObject({ outcome: "CLAIMED" });

    expect(confirmManually).toHaveBeenCalledWith(
      "manual-transfer",
      expect.objectContaining({
        referenceId: "SB-10482",
        status: "SUCCEEDED",
        amountCents: 125_000,
        raw: expect.objectContaining({ overpaidCents: 5_000, source: "gateway-claim" }),
      }),
    );
  });

  it("grants on a replay of our own earlier claim, too", async () => {
    const { service, confirmManually } = autoVerifyWith([{ ...CLAIMED, replay: true }]);

    await service.settle(order() as never);

    expect(confirmManually).toHaveBeenCalled();
  });

  it.each(OTHER_OUTCOMES)("leaves the order pending on $outcome", async (outcome) => {
    const { service, confirmManually } = autoVerifyWith([outcome]);

    await expect(service.settle(order() as never)).resolves.toEqual(outcome);

    expect(confirmManually).not.toHaveBeenCalled();
  });

  it("retries shortly when the claim worked but the grant did not", async () => {
    const confirmManually = vi.fn(async () => {
      throw new Error("database blip");
    });
    const { service, updates } = autoVerifyWith([CLAIMED], confirmManually);

    await expect(service.settle(order() as never)).resolves.toMatchObject({ outcome: "CLAIMED" });

    expect(secondsUntil(lastUpdate(updates).paymentClaimRetryAt)).toBe(30);
  });

  it("does not ask the gateway when another of our orders holds the receipt", async () => {
    local.holder = { orderNumber: "SB-10481", status: "PENDING", createdAt: new Date() };
    const { service, gateway, confirmManually } = autoVerifyWith([CLAIMED]);

    await expect(service.settle(order() as never)).resolves.toBeNull();

    expect(gateway.calls).toHaveLength(0);
    expect(confirmManually).not.toHaveBeenCalled();
  });

  it("does not claim for a cancelled order, and stops its retries", async () => {
    const { service, gateway, updates } = autoVerifyWith([CLAIMED]);

    await expect(service.settle(order({ status: "CANCELLED" }) as never)).resolves.toBeNull();

    expect(gateway.calls).toHaveLength(0);
    expect(lastUpdate(updates)).toEqual({ paymentClaimRetryAt: null });
  });

  it("only claims — never re-grants — an order staff already confirmed", async () => {
    const { service, gateway, confirmManually } = autoVerifyWith([CLAIMED]);

    await service.settle(order({ status: "PAYMENT_CONFIRMED" }) as never);

    expect(gateway.calls).not.toHaveLength(0);
    expect(confirmManually).not.toHaveBeenCalled();
  });

  it("keeps a confirmed order on the slow retry schedule after the fast one", async () => {
    const { service, updates } = autoVerifyWith([{ outcome: "PENDING_ARRIVAL" }]);

    await service.settle(
      order({
        status: "PAYMENT_CONFIRMED",
        paymentClaimAttempts: FAST_RETRY_DELAYS_SECONDS.length,
      }) as never,
    );

    expect(secondsUntil(lastUpdate(updates).paymentClaimRetryAt)).toBe(
      LATE_RETRY_INTERVAL_SECONDS,
    );
  });
});

describe("OrderAutoVerifyService.tryAutoConfirm", () => {
  const placed = { orderNumber: "SB-10482", paymentMethod: "manual-transfer" };

  it("grants at checkout when the claim succeeds", async () => {
    const { service, confirmManually } = autoVerifyWith([CLAIMED]);
    reread.row = order();

    await service.tryAutoConfirm(placed as never).catch(() => undefined);

    expect(confirmManually).toHaveBeenCalledWith(
      "manual-transfer",
      expect.objectContaining({ referenceId: "SB-10482", amountCents: 125_000 }),
    );
  });

  it("leaves a cash-on-delivery order alone", async () => {
    const { service, gateway } = autoVerifyWith([CLAIMED]);
    const cod = { orderNumber: "SB-1", paymentMethod: "cash-on-delivery" };

    await expect(service.tryAutoConfirm(cod as never)).resolves.toBe(cod);
    expect(gateway.calls).toHaveLength(0);
  });

  it("never fails checkout when the gateway is down", async () => {
    const { service } = autoVerifyWith([{ outcome: "UNAVAILABLE", reason: "connection refused" }]);
    reread.row = order();

    await expect(service.tryAutoConfirm(placed as never)).resolves.toBe(placed);
  });
});

/* -------------------------------------------------------------------------- */

const CONTEXT: AdminContext = {
  actor: { sub: "admin-1", sid: "s-1", role: "STAFF", email: "staff@shop.com", iat: 0, exp: 0 },
};

function adminWith(answers: ClaimOutcome[], row: TestOrder = order()) {
  const claims = claimsWith(answers);
  const auditRecord = vi.fn(async (entry: { action: string; note?: string }) => {
    void entry;
  });
  const transitionAndCommit = vi.fn(async () => undefined);
  const confirmManually = vi.fn(async () => ({ confirmed: true }));

  const service = new AdminOrdersService(
    { db: { transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})) } } as never,
    { transitionAndCommit } as never,
    { confirmManually } as never,
    { record: auditRecord, recordDetached: vi.fn(async () => undefined) } as never,
    claims.service,
    {} as never,
    { get: vi.fn() } as never,
  );

  vi.spyOn(
    service as unknown as { requireOrder: () => Promise<unknown> },
    "requireOrder",
  ).mockResolvedValue(row);
  vi.spyOn(service as unknown as { detail: () => Promise<unknown> }, "detail").mockResolvedValue(
    {},
  );

  return { ...claims, service, auditRecord, transitionAndCommit, confirmManually };
}

const REASON = "Saw the payment in the bKash merchant app.";

describe("admin grants claim the payment first", () => {
  it("confirms once the gateway says CLAIMED", async () => {
    const { service, confirmManually, gateway } = adminWith([CLAIMED]);

    await service.confirmPayment("SB-10482", { amountCents: 125_000 }, CONTEXT);

    expect(gateway.calls).not.toHaveLength(0);
    expect(confirmManually).toHaveBeenCalled();
  });

  it("claims on the transition door into PAYMENT_CONFIRMED as well", async () => {
    const { service, gateway, transitionAndCommit } = adminWith([CLAIMED]);

    await service.transition("SB-10482", { status: "PAYMENT_CONFIRMED" }, CONTEXT);

    expect(gateway.calls).not.toHaveLength(0);
    expect(transitionAndCommit).toHaveBeenCalled();
  });

  it.each<ClaimOutcome>([
    { outcome: "ALREADY_CLAIMED", claimedAt: null },
    { outcome: "UNDERPAID", expectedPoisha: 125_000, paidPoisha: 90_000 },
  ])("refuses $outcome outright, even with a reason", async (outcome) => {
    const { service, confirmManually } = adminWith([outcome]);

    await expect(
      service.confirmPayment(
        "SB-10482",
        { amountCents: 125_000, gatewayClaimOverride: REASON },
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(PaymentClaimRefusedError);

    expect(confirmManually).not.toHaveBeenCalled();
  });

  it.each<ClaimOutcome>([
    { outcome: "PENDING_ARRIVAL" },
    { outcome: "UNAVAILABLE", reason: "timeout" },
    { outcome: "REJECTED", rejection: "TOO_OLD", reason: "too old" },
    { outcome: "MISCONFIGURED", reason: "bad secret" },
  ])("asks for a reason on $outcome", async (outcome) => {
    const { service, confirmManually } = adminWith([outcome]);

    await expect(
      service.confirmPayment("SB-10482", { amountCents: 125_000 }, CONTEXT),
    ).rejects.toBeInstanceOf(PaymentNotClaimedError);

    expect(confirmManually).not.toHaveBeenCalled();
  });

  it("confirms with a reason, records it, and leaves the claim to the worker", async () => {
    const { service, confirmManually, auditRecord, updates } = adminWith([
      { outcome: "PENDING_ARRIVAL" },
    ]);

    await service.confirmPayment(
      "SB-10482",
      { amountCents: 125_000, gatewayClaimOverride: REASON },
      CONTEXT,
    );

    expect(confirmManually).toHaveBeenCalled();
    expect(auditRecord.mock.calls[0]?.[0]).toMatchObject({
      action: "GATEWAY_CLAIM_OVERRIDE",
      note: REASON,
    });
    expect(lastUpdate(updates).paymentClaimRetryAt).toBeInstanceOf(Date);
  });

  it("does not ask the gateway for cash on delivery", async () => {
    const cod = order({ paymentMethod: "cash-on-delivery", transactionId: null });
    const { service, gateway, transitionAndCommit } = adminWith([], cod);

    await service.transition("SB-10482", { status: "PAYMENT_CONFIRMED" }, CONTEXT);

    expect(gateway.calls).toHaveLength(0);
    expect(transitionAndCommit).toHaveBeenCalled();
  });
});

describe("Check & confirm", () => {
  it("confirms a pending order when the claim succeeds", async () => {
    const { service, confirmManually } = adminWith([CLAIMED]);

    const result = await service.verifyPayment("SB-10482", CONTEXT);

    expect(result.confirmed).toBe(true);
    expect(result.record).toMatchObject({ outcome: "CLAIMED", claimKey: "SB-10482:1" });
    expect(result.summary).toMatch(/Overpaid by ৳50\.00/);
    expect(confirmManually).toHaveBeenCalledWith(
      "manual-transfer",
      expect.objectContaining({ amountCents: 125_000 }),
    );
  });

  it("reports, without confirming, when the SMS is not in yet", async () => {
    const { service, confirmManually } = adminWith([{ outcome: "PENDING_ARRIVAL" }]);

    const result = await service.verifyPayment("SB-10482", CONTEXT);

    expect(result.confirmed).toBe(false);
    expect(result.record.outcome).toBe("PENDING_ARRIVAL");
    expect(confirmManually).not.toHaveBeenCalled();
  });

  it("refuses to claim for a cancelled order", async () => {
    const { service, gateway } = adminWith([CLAIMED], order({ status: "CANCELLED" }));

    await expect(service.verifyPayment("SB-10482", CONTEXT)).rejects.toBeInstanceOf(
      InvalidInputError,
    );
    expect(gateway.calls).toHaveLength(0);
  });

  it("answers NO_RECEIPT for an order with nothing to claim", async () => {
    const { service, gateway } = adminWith([], order({ transactionId: null }));

    await expect(service.verifyPayment("SB-10482", CONTEXT)).resolves.toMatchObject({
      record: { outcome: "NO_RECEIPT" },
      confirmed: false,
    });
    expect(gateway.calls).toHaveLength(0);
  });
});

describe("toClaimRecord", () => {
  const context = { transactionId: "8F3K2M9X01", expectedCents: 125_000, claimKey: "SB-10482:1" };

  it("keeps the key, the amounts and the overpayment for a claim, in the log's names", () => {
    expect(toClaimRecord(CLAIMED, context)).toMatchObject({
      outcome: "CLAIMED",
      claimKey: "SB-10482:1",
      provider: "bkash",
      paidCents: 130_000,
      expectedCents: 125_000,
      overpaidCents: 5_000,
      claimedAt: "2026-10-21T08:14:02.000Z",
    });
  });

  it("keeps what arrived on an underpayment", () => {
    expect(
      toClaimRecord({ outcome: "UNDERPAID", expectedPoisha: 125_000, paidPoisha: 90_000 }, context),
    ).toMatchObject({ outcome: "UNDERPAID", paidCents: 90_000, expectedCents: 125_000 });
  });

  it("keeps the reason on a refusal", () => {
    expect(
      toClaimRecord({ outcome: "REJECTED", rejection: "TOO_OLD", reason: "too old" }, context),
    ).toMatchObject({ outcome: "REJECTED", reason: "too old" });
  });
});

describe("heldClaimOf", () => {
  const at = (minute: number) => `2026-10-21T08:${String(minute).padStart(2, "0")}:00.000Z`;

  it("reports the claim and any overpayment", () => {
    expect(
      heldClaimOf([
        {
          outcome: "CLAIMED",
          checkedAt: at(2),
          transactionId: "8F3K2M9X01",
          claimedAt: at(2),
          overpaidCents: 5_000,
        },
        { outcome: "PENDING_ARRIVAL", checkedAt: at(1), transactionId: "8F3K2M9X01" },
      ]),
    ).toEqual({ transactionId: "8F3K2M9X01", claimedAt: at(2), overpaidCents: 5_000 });
  });

  it("is null once the claim was released, until it is claimed again", () => {
    const claimed = { outcome: "CLAIMED" as const, checkedAt: at(1), transactionId: "X" };
    const released = { outcome: "RELEASED" as const, checkedAt: at(2), transactionId: "X" };

    expect(heldClaimOf([released, claimed])).toBeNull();
    expect(heldClaimOf([{ ...claimed, checkedAt: at(3) }, released, claimed])).not.toBeNull();
  });

  it("is null for an order that never claimed", () => {
    expect(heldClaimOf([{ outcome: "PENDING_ARRIVAL", checkedAt: at(1), transactionId: "X" }])).toBeNull();
  });
});

describe("normaliseBdPhone", () => {
  it.each([
    ["01615951697", "01615951697"],
    ["+880 1615-951697", "01615951697"],
    ["8801615951697", "01615951697"],
    ["008801615951697", "01615951697"],
    ["(01615) 951697", "01615951697"],
    ["০১৬১৫৯৫১৬৯৭", "01615951697"],
  ])("reads %s as %s", (raw, expected) => {
    expect(normaliseBdPhone(raw)).toBe(expected);
  });

  it.each(["01215951697", "0161595169", "016159516971", "+44 20 7946 0000", ""])(
    "refuses %s",
    (raw) => {
      expect(normaliseBdPhone(raw)).toBeNull();
    },
  );
});

describe("senderPhoneFor", () => {
  it("sends a stored number in the 01XXXXXXXXX form", () => {
    expect(senderPhoneFor("+880 1615-951697")).toBe("01615951697");
  });

  it("sends an old order's unrecognised number as digits, for the gateway to judge", () => {
    expect(senderPhoneFor("+44 20 7946 0000")).toBe("442079460000");
  });

  it("sends nothing when nothing was typed", () => {
    expect(senderPhoneFor(null)).toBeUndefined();
    expect(senderPhoneFor("  ")).toBeUndefined();
  });
});
