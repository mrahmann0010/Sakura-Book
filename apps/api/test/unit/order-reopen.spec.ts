import { describe, expect, it, vi } from "vitest";
import { AdminOrdersService, type AdminContext } from "../../src/admin/orders/admin-orders.service";
import { InvalidInputError } from "../../src/common/errors";
import { OutOfStockError } from "../../src/inventory/inventory.errors";
import { REOPEN_WINDOW_DAYS, reopenBlocker } from "../../src/orders/order-reopen";
import { TransactionIdAlreadyUsedError } from "../../src/orders/order.errors";
import { OrdersService } from "../../src/orders/orders.service";

/**
 * Reopening an order rejected by mistake.
 *
 * What is worth pinning is not that the status moves — it is that the two
 * things the cancellation gave away (the copies and the TrxID) are taken back,
 * or the reopen is refused when someone else has them now.
 */

const NOW = new Date("2026-09-17T12:00:00Z");
const HOUR = 60 * 60 * 1000;

const placed = { status: "PENDING" as const, createdAt: new Date(NOW.getTime() - 3 * HOUR) };
const cancelled = { status: "CANCELLED" as const, createdAt: new Date(NOW.getTime() - 2 * HOUR) };
const adminCancelledAt = new Date(cancelled.createdAt.getTime() + 50);

describe("reopenBlocker", () => {
  it("allows an order staff rejected from PENDING, recently", () => {
    expect(reopenBlocker("CANCELLED", [placed, cancelled], adminCancelledAt, NOW)).toBeNull();
  });

  it("refuses an order that is not cancelled", () => {
    expect(reopenBlocker("PENDING", [placed], null, NOW)).not.toBeNull();
  });

  it("refuses an order cancelled after payment was confirmed", () => {
    const confirmed = {
      status: "PAYMENT_CONFIRMED" as const,
      createdAt: new Date(NOW.getTime() - 2.5 * HOUR),
    };
    expect(
      reopenBlocker("CANCELLED", [placed, confirmed, cancelled], adminCancelledAt, NOW),
    ).toMatch(/pending/);
  });

  it("refuses an order the customer cancelled themselves", () => {
    expect(reopenBlocker("CANCELLED", [placed, cancelled], null, NOW)).toMatch(/customer/);
  });

  it("does not count a staff cancellation from before an earlier reopen", () => {
    // Staff rejected, it was reopened, then the customer cancelled it.
    const earlierAdmin = new Date(NOW.getTime() - 10 * HOUR);
    expect(reopenBlocker("CANCELLED", [placed, cancelled], earlierAdmin, NOW)).toMatch(/customer/);
  });

  it(`refuses after ${REOPEN_WINDOW_DAYS} days`, () => {
    const later = new Date(cancelled.createdAt.getTime() + (REOPEN_WINDOW_DAYS + 1) * 24 * HOUR);
    expect(reopenBlocker("CANCELLED", [placed, cancelled], adminCancelledAt, later)).toMatch(
      /days/,
    );
  });
});

/** A transaction stub just deep enough for `OrdersService.reopen`. */
function tx(options: { claim?: { orderNumber: string }; updatedRows?: number } = {}) {
  const insertValues = vi.fn(async () => undefined);

  const stub = {
    query: {
      orders: {
        findFirst: vi.fn(async () => ({ status: "CANCELLED", transactionId: "PAY123" })),
      },
      orderItems: {
        findMany: vi.fn(async () => [
          { bookId: "book-1", quantity: 2 },
          { bookId: null, quantity: 1 },
        ]),
      },
    },
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: async () => (options.claim ? [options.claim] : []) }),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => Array.from({ length: options.updatedRows ?? 1 }, () => ({})),
        }),
      }),
    }),
    insert: () => ({ values: insertValues }),
  };

  return { stub, insertValues };
}

function ordersService(decrement = vi.fn(async () => 0)) {
  const service = new OrdersService({} as never, { decrement } as never, {} as never, {} as never);
  return { service, decrement };
}

describe("OrdersService.reopen", () => {
  it("takes the copies back off the shelf and writes a PENDING history row", async () => {
    const { service, decrement } = ordersService();
    const { stub, insertValues } = tx();

    await service.reopen("order-1", stub as never, "Order reopened for review");

    // The deleted title (null bookId) was never restocked, so it is skipped.
    expect(decrement).toHaveBeenCalledTimes(1);
    expect(decrement).toHaveBeenCalledWith("book-1", 2, stub);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: "order-1", status: "PENDING" }),
    );
  });

  it("refuses when another live order has taken the TrxID", async () => {
    const { service, decrement } = ordersService();
    const { stub } = tx({ claim: { orderNumber: "NB-50001" } });

    await expect(service.reopen("order-1", stub as never, "note")).rejects.toBeInstanceOf(
      TransactionIdAlreadyUsedError,
    );
    expect(decrement).not.toHaveBeenCalled();
  });

  it("refuses when the copies have sold since", async () => {
    const { service } = ordersService(
      vi.fn(async () => {
        throw new OutOfStockError("book-1", 2, 0);
      }),
    );
    const { stub, insertValues } = tx();

    await expect(service.reopen("order-1", stub as never, "note")).rejects.toBeInstanceOf(
      OutOfStockError,
    );
    expect(insertValues).not.toHaveBeenCalled();
  });
});

const CONTEXT: AdminContext = {
  actor: { sub: "admin-1", sid: "s-1", role: "STAFF", email: "desk@shop.com", iat: 0, exp: 0 },
};

const CANCELLED_ORDER = { id: "order-1", orderNumber: "NB-40718", status: "CANCELLED" };

function adminService(blockedReason: string | null) {
  const reopen = vi.fn(async () => undefined);
  const announceStatusChange = vi.fn();
  const auditRecord = vi.fn(async () => undefined);

  const adminOrders = new AdminOrdersService(
    { db: { transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn({})) } } as never,
    { reopen, announceStatusChange } as never,
    {} as never,
    { record: auditRecord } as never,
    {} as never,
    {} as never,
    {} as never,
  );

  const spy = adminOrders as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  vi.spyOn(spy, "requireOrder").mockResolvedValue(CANCELLED_ORDER);
  vi.spyOn(spy, "detail").mockResolvedValue({});
  vi.spyOn(spy, "reopenState").mockResolvedValue({
    allowed: blockedReason === null,
    blockedReason,
  });

  return { adminOrders, reopen, announceStatusChange, auditRecord };
}

describe("AdminOrdersService.reopen", () => {
  const REASON = "TrxID SMS arrived an hour after rejecting.";

  it("reopens, audits with the reason, and announces after commit", async () => {
    const { adminOrders, reopen, auditRecord, announceStatusChange } = adminService(null);

    await adminOrders.reopen(CANCELLED_ORDER.orderNumber, { reason: REASON }, CONTEXT);

    expect(reopen).toHaveBeenCalledWith("order-1", expect.anything(), expect.any(String));
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ORDER_REOPEN", note: REASON }),
      expect.anything(),
    );
    expect(announceStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({ from: "CANCELLED", to: "PENDING" }),
    );
  });

  it("refuses without touching the order when a rule blocks it", async () => {
    const { adminOrders, reopen, auditRecord } = adminService(
      "The customer cancelled this order themselves.",
    );

    await expect(
      adminOrders.reopen(CANCELLED_ORDER.orderNumber, { reason: REASON }, CONTEXT),
    ).rejects.toBeInstanceOf(InvalidInputError);
    expect(reopen).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });
});
