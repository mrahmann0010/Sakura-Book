import { describe, expect, it, vi } from "vitest";
import { AdminOrdersService, type AdminContext } from "../../src/admin/orders/admin-orders.service";
import { InvalidInputError } from "../../src/common/errors";

/**
 * A duplicate receipt must be refused on *every* path that grants an order.
 *
 * This is the test for a real gap. `confirmPayment` had checked for a reused
 * transaction ID since the check existed; `transition` — which reaches
 * PAYMENT_CONFIRMED just as effectively, through the state machine — had not.
 * The admin panel happened not to render that route for a pending order, so
 * nothing in the UI revealed it, but the endpoint was open to any admin token
 * and to any future change in which buttons get drawn.
 *
 * The two paths now share one private guard. These tests drive them through
 * their public methods rather than calling the guard directly, because "the
 * guard is correct" was never the thing in doubt — "every door goes through
 * the guard" was.
 */

const CONTEXT: AdminContext = {
  actor: {
    sub: "admin-1",
    sid: "session-1",
    role: "STAFF",
    email: "staff@shop.com",
    iat: 0,
    exp: 0,
  },
};

const ORDER = {
  id: "order-1",
  orderNumber: "NB-40719",
  status: "PENDING",
  totalCents: 125000,
  paymentMethod: "manual-transfer",
  transactionId: "PAY123",
  provider: "bkash",
};

const CLAIM = { orderNumber: "NB-40718", status: "PAYMENT_CONFIRMED", createdAt: new Date() };

/**
 * The service with every collaborator stubbed, and a `findTransactionIdClaim`
 * that reports the receipt as already spent.
 *
 * `requireOrder` and the claim lookup are the only two reads that matter here,
 * so the db stub answers those and nothing else — a fuller fake would be
 * asserting Drizzle's behaviour rather than this service's.
 */
function serviceWithDuplicate(overrides: { auditThrows?: boolean } = {}) {
  const auditRecord = vi.fn(async (entry: { action: string; note?: string }) => {
    void entry;
    if (overrides.auditThrows) throw new Error("audit log unavailable");
  });

  const transitionAndCommit = vi.fn(async () => undefined);
  const confirmManually = vi.fn(async () => ({ confirmed: true }));

  const service = new AdminOrdersService(
    {
      db: {
        // The claim lookup and requireOrder both go through select(); the
        // service is driven by what those return, which the spies below fix.
        transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
      },
    } as never,
    { transitionAndCommit } as never,
    { confirmManually, forOrder: vi.fn(async () => []) } as never,
    { record: auditRecord, recordDetached: vi.fn(async () => undefined) } as never,
    { verify: vi.fn() } as never,
    {
      record: vi.fn(),
      latestFor: vi.fn(async () => new Map()),
      historyFor: vi.fn(async () => []),
      findDuplicatedReceipts: vi.fn(async () => new Set<string>()),
    } as never,
    // Config, read only by the Pathao export — nothing on the duplicate-receipt
    // paths touches it.
    { get: vi.fn(() => "Nihonova Academy") } as never,
  );

  // The two reads the guard depends on, stubbed at the service boundary.
  vi.spyOn(
    service as unknown as { requireOrder: (n: string) => Promise<unknown> },
    "requireOrder",
  ).mockResolvedValue(ORDER);

  return { service, auditRecord, transitionAndCommit, confirmManually };
}

/* `findTransactionIdClaim` is a module-level function, so it is mocked at the
   module boundary rather than injected — the service imports it directly, and
   changing that to a provider purely for testability would be the test
   dictating the design. */
vi.mock("../../src/orders", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/orders")>()),
  findTransactionIdClaim: vi.fn(async () => CLAIM),
}));

describe("the duplicate-receipt guard", () => {
  it("refuses a transition to PAYMENT_CONFIRMED, not just confirmPayment", async () => {
    const { service, transitionAndCommit } = serviceWithDuplicate();

    await expect(
      service.transition(ORDER.orderNumber, { status: "PAYMENT_CONFIRMED" }, CONTEXT),
    ).rejects.toBeInstanceOf(InvalidInputError);

    // The refusal has to happen *before* the move, not be reported after it.
    expect(transitionAndCommit).not.toHaveBeenCalled();
  });

  it("refuses confirmPayment for the same receipt", async () => {
    const { service, confirmManually } = serviceWithDuplicate();

    await expect(
      service.confirmPayment(ORDER.orderNumber, { amountCents: ORDER.totalCents }, CONTEXT),
    ).rejects.toBeInstanceOf(InvalidInputError);

    expect(confirmManually).not.toHaveBeenCalled();
  });

  /**
   * A transition that is not a grant must not be blocked. Cancelling an order
   * whose receipt is duplicated is the *recommended* fix for a duplicate —
   * making the guard fire here would trap staff with no way out.
   */
  it("does not block a cancellation", async () => {
    const { service, transitionAndCommit } = serviceWithDuplicate();

    vi.spyOn(
      service as unknown as { detail: (n: string) => Promise<unknown> },
      "detail",
    ).mockResolvedValue({});

    await service.transition(ORDER.orderNumber, { status: "CANCELLED" }, CONTEXT);

    expect(transitionAndCommit).toHaveBeenCalled();
  });

  it("allows the grant when a written reason is given, and records it", async () => {
    const { service, auditRecord, transitionAndCommit } = serviceWithDuplicate();

    vi.spyOn(
      service as unknown as { detail: (n: string) => Promise<unknown> },
      "detail",
    ).mockResolvedValue({});

    await service.transition(
      ORDER.orderNumber,
      {
        status: "PAYMENT_CONFIRMED",
        duplicateReceiptOverride: "Customer paid for both orders in one bKash transfer.",
      },
      CONTEXT,
    );

    expect(transitionAndCommit).toHaveBeenCalled();

    const entry = auditRecord.mock.calls[0]?.[0];
    expect(entry?.action).toBe("DUPLICATE_RECEIPT_OVERRIDE");
    expect(entry?.note).toContain("one bKash transfer");
  });

  /**
   * The direction that matters: an override that cannot be recorded must not
   * proceed. Nothing else on the order captures that a safety check was
   * deliberately bypassed, so an unlogged override is worse than a failed
   * request.
   */
  it("refuses the grant when the override cannot be written to the audit log", async () => {
    const { service, transitionAndCommit } = serviceWithDuplicate({ auditThrows: true });

    await expect(
      service.transition(
        ORDER.orderNumber,
        {
          status: "PAYMENT_CONFIRMED",
          duplicateReceiptOverride: "Customer paid for both orders in one bKash transfer.",
        },
        CONTEXT,
      ),
    ).rejects.toThrow();

    expect(transitionAndCommit).not.toHaveBeenCalled();
  });
});
