import { describe, expect, it, vi } from "vitest";
import { checkoutSchema, type PlaceOrderRequest } from "@sakura/contracts";
import { AdminCodService } from "../../src/admin/orders/admin-cod.service";
import { codConfirmationOf } from "../../src/admin/orders/admin-order.mapper";
import {
  COD_APPROVED_NOTE,
  COD_DENIED_NOTE,
  codApprovedSms,
  codPendingTransitionBlocker,
} from "../../src/admin/orders/cod-approval";
import { orderValuesFrom } from "../../src/orders/checkout.service";
import { reopenBlocker } from "../../src/orders/order-reopen";

/**
 * The cash-on-delivery approval flow (docs/cod-orders.md Step 1): the
 * customer's commitment at checkout, the one door out of PENDING, and what
 * approving and denying write.
 */

const CUSTOMER = {
  fullName: "Rumana Haque",
  phone: "01700000000",
  address: "12 Green Road",
  city: "Dhaka",
  zone: "dhaka-city",
};

describe("the COD commitment at checkout", () => {
  it("refuses a COD order without the box ticked", () => {
    const result = checkoutSchema.safeParse({ ...CUSTOMER, method: "cash-on-delivery" });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toContain("codAcknowledged");
  });

  it("accepts a COD order with the box ticked", () => {
    const result = checkoutSchema.safeParse({
      ...CUSTOMER,
      method: "cash-on-delivery",
      codAcknowledged: true,
    });

    expect(result.success).toBe(true);
  });

  it("does not ask a transfer customer for it", () => {
    const result = checkoutSchema.safeParse({
      ...CUSTOMER,
      method: "manual-transfer",
      provider: "bkash",
      senderNumber: "01711111111",
      transactionId: "8F3K2M9X01",
    });

    expect(result.success).toBe(true);
  });

  it("stamps the order with when it was ticked, and only for COD", () => {
    const priced = { subtotalCents: 1, deliveryCents: 0, totalCents: 1, parcelWeightGrams: 249 } as never;
    const request = (method: string, extra = {}) =>
      ({ items: [], customer: { ...CUSTOMER, method, ...extra } }) as unknown as PlaceOrderRequest;

    expect(
      orderValuesFrom(request("cash-on-delivery", { codAcknowledged: true }), priced, "k1")
        .codAcknowledgedAt,
    ).toBeInstanceOf(Date);
    expect(
      orderValuesFrom(request("manual-transfer", { codAcknowledged: true }), priced, "k2")
        .codAcknowledgedAt,
    ).toBeNull();
  });
});

describe("one door out of PENDING for COD", () => {
  it("refuses approving a pending COD order through the generic transition", () => {
    expect(codPendingTransitionBlocker("cash-on-delivery", "PENDING", ["PAYMENT_CONFIRMED"])).toMatch(
      /Approve/,
    );
  });

  it("refuses it through an advance walk as well", () => {
    expect(
      codPendingTransitionBlocker("cash-on-delivery", "PENDING", [
        "PAYMENT_CONFIRMED",
        "PROCESSING",
        "SHIPPED",
      ]),
    ).toMatch(/Approve/);
  });

  it("refuses cancelling a pending COD order without a reason", () => {
    expect(codPendingTransitionBlocker("cash-on-delivery", "PENDING", ["CANCELLED"])).toMatch(/Deny/);
  });

  it("leaves prepaid orders and approved COD orders alone", () => {
    expect(codPendingTransitionBlocker("manual-transfer", "PENDING", ["PAYMENT_CONFIRMED"])).toBeNull();
    expect(codPendingTransitionBlocker("manual-transfer", "PENDING", ["CANCELLED"])).toBeNull();
    expect(
      codPendingTransitionBlocker("cash-on-delivery", "PAYMENT_CONFIRMED", ["PROCESSING"]),
    ).toBeNull();
    expect(codPendingTransitionBlocker("cash-on-delivery", "PROCESSING", ["CANCELLED"])).toBeNull();
  });
});

describe("the approval SMS", () => {
  it("fits one Bangla (UCS-2) segment", () => {
    // UCS-2 is billed in UTF-16 code units, 70 to a single segment. Order
    // numbers are two letters, a dash and five digits.
    const message = codApprovedSms("SB-10482");

    expect(message.length).toBeLessThanOrEqual(70);
    expect(message).toContain("SB-10482");
  });
});

describe("the panel's COD block", () => {
  const base = {
    codAcknowledgedAt: new Date("2026-11-19T10:00:00Z"),
    codConfirmedAt: null,
    codConfirmedBy: null,
    codConfirmationChannel: null,
    codConfirmationNote: null,
  };

  it("is null for a prepaid order", () => {
    expect(codConfirmationOf({ ...base, paymentMethod: "manual-transfer" })).toBeNull();
  });

  it("is present for a COD order before it is approved", () => {
    expect(codConfirmationOf({ ...base, paymentMethod: "cash-on-delivery" })).toEqual({
      acknowledgedAt: "2026-11-19T10:00:00.000Z",
      confirmedAt: null,
      confirmedByEmail: null,
      channel: null,
      note: null,
    });
  });
});

describe("a denied COD order can be reopened like any desk rejection", () => {
  it("counts the denial's audit entry, written in the same transaction, as staff cancelling", () => {
    const at = new Date();
    const history = [
      { status: "PENDING" as const, createdAt: new Date(at.getTime() - 60_000) },
      { status: "CANCELLED" as const, createdAt: at },
    ];

    // The audit row commits with the cancellation, so it carries the same
    // transaction timestamp — equal, not later.
    expect(reopenBlocker("CANCELLED", history, at, at)).toBeNull();
  });
});

describe("AdminCodService", () => {
  const CONTEXT = { actor: { sub: "u1", email: "desk@shop.com", role: "STAFF" } } as never;

  function serviceWith(order: Record<string, unknown> | undefined, sms = vi.fn(async () => {})) {
    const updates: Record<string, unknown>[] = [];
    const tx = {
      update: () => ({
        set: (values: Record<string, unknown>) => {
          updates.push(values);
          return { where: async () => undefined };
        },
      }),
    };
    const transition = vi.fn(async () => undefined);
    const announceStatusChange = vi.fn();
    const auditRecord = vi.fn(async (_entry: Record<string, unknown>) => undefined);
    const detail = vi.fn(async () => ({ orderNumber: "SB-10482" }));

    const service = new AdminCodService(
      {
        db: {
          query: { orders: { findFirst: vi.fn(async () => order) } },
          transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
        },
      } as never,
      { transition, announceStatusChange } as never,
      { record: auditRecord } as never,
      { send: sms } as never,
      { detail } as never,
    );

    return { service, updates, transition, announceStatusChange, auditRecord, sms };
  }

  const PENDING_COD = {
    id: "o1",
    orderNumber: "SB-10482",
    status: "PENDING",
    paymentMethod: "cash-on-delivery",
    customerPhone: "01700000000",
  };

  it("approves: moves to PAYMENT_CONFIRMED, records how, audits, announces, texts", async () => {
    const { service, updates, transition, auditRecord, announceStatusChange, sms } =
      serviceWith(PENDING_COD);

    await service.approve("sb-10482", { channel: "FACEBOOK", note: " profile looks real " }, CONTEXT);

    expect(transition).toHaveBeenCalledWith("o1", "PAYMENT_CONFIRMED", expect.anything(), COD_APPROVED_NOTE);
    expect(updates[0]).toMatchObject({
      codConfirmedBy: "desk@shop.com",
      codConfirmationChannel: "FACEBOOK",
      codConfirmationNote: "profile looks real",
    });
    expect(updates[0]?.codConfirmedAt).toBeInstanceOf(Date);
    expect(auditRecord.mock.calls[0]?.[0]).toMatchObject({
      action: "COD_APPROVED",
      entityId: "SB-10482",
      after: { status: "PAYMENT_CONFIRMED", channel: "FACEBOOK" },
    });
    expect(announceStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({ from: "PENDING", to: "PAYMENT_CONFIRMED" }),
    );
    await vi.waitFor(() => expect(sms).toHaveBeenCalledWith("01700000000", codApprovedSms("SB-10482")));
  });

  it("still approves when the SMS fails", async () => {
    const failing = vi.fn(async () => {
      throw new Error("gateway down");
    });
    const { service, transition } = serviceWith(PENDING_COD, failing);

    await expect(service.approve("SB-10482", { channel: "PHONE" }, CONTEXT)).resolves.toBeDefined();
    expect(transition).toHaveBeenCalled();
  });

  it("denies: cancels with a neutral customer note and keeps the reason staff-only", async () => {
    const { service, transition, auditRecord, sms } = serviceWith(PENDING_COD);
    const reason = "Profile created yesterday, no photos";

    await service.deny("SB-10482", { reason }, CONTEXT);

    expect(transition).toHaveBeenCalledWith("o1", "CANCELLED", expect.anything(), COD_DENIED_NOTE);
    expect(COD_DENIED_NOTE).not.toContain(reason);
    expect(auditRecord.mock.calls[0]?.[0]).toMatchObject({
      action: "COD_DENIED",
      after: { status: "CANCELLED" },
      note: reason,
    });
    expect(sms).not.toHaveBeenCalled();
  });

  it("refuses an order that is not cash on delivery", async () => {
    const { service, transition } = serviceWith({ ...PENDING_COD, paymentMethod: "manual-transfer" });

    await expect(service.approve("SB-10482", { channel: "FACEBOOK" }, CONTEXT)).rejects.toThrow(
      /cash-on-delivery/,
    );
    expect(transition).not.toHaveBeenCalled();
  });

  it("refuses an order that has left PENDING", async () => {
    const { service, transition } = serviceWith({ ...PENDING_COD, status: "PAYMENT_CONFIRMED" });

    await expect(service.deny("SB-10482", { reason: "changed their mind" }, CONTEXT)).rejects.toThrow(
      /already/,
    );
    expect(transition).not.toHaveBeenCalled();
  });

  it("404s an order that does not exist", async () => {
    const { service } = serviceWith(undefined);

    await expect(service.approve("SB-00000", { channel: "FACEBOOK" }, CONTEXT)).rejects.toThrow();
  });
});
