import {
  adminEditPaymentDetailsRequestSchema,
  checkoutSchema,
  cleanTransactionId,
} from "@sakura/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminOrdersService, type AdminContext } from "../../src/admin/orders/admin-orders.service";
import { InvalidInputError } from "../../src/common/errors";

/**
 * Correcting a receipt the customer typed wrong — the transaction ID or the
 * wallet number it was sent from: the label cleanup checkout applies, and the
 * desk's edit.
 */

describe("cleanTransactionId", () => {
  it.each([
    ["TrxID ABC1234XYZ", "ABC1234XYZ"],
    ["trxid: ABC1234XYZ", "ABC1234XYZ"],
    ["TrxIDABC1234XYZ", "ABC1234XYZ"],
    ["Trx ID - ABC1234XYZ", "ABC1234XYZ"],
    ["TxnID: 7A1B2C3D", "7A1B2C3D"],
    ["Transaction ID: 7A1B2C3D", "7A1B2C3D"],
    ["Trans. No 7A1B2C3D", "7A1B2C3D"],
    ["TRX: 7A1B2C3D", "7A1B2C3D"],
    ["ট্রানজেকশন আইডি: 8F3K2M9X01", "8F3K2M9X01"],
    ['"8F3K2M9X01".', "8F3K2M9X01"],
    ["#8F3K2M9X01", "8F3K2M9X01"],
    ["১২৩৪৫৬৭৮৯০", "1234567890"],
  ])("cleans %j to %j", (input, expected) => {
    expect(cleanTransactionId(input)).toBe(expected);
  });

  it.each(["8F3K2M9X01", "BKA1B2C3D4", "TXN7A1B2C3", "TRX9A8B7C6", "ABC 123-XYZ"])(
    "leaves a plain ID like %j alone",
    (input) => {
      expect(cleanTransactionId(input)).toBe(input);
    },
  );

  it("leaves nothing when only a label was typed", () => {
    expect(cleanTransactionId("TrxID:")).toBe("");
  });
});

describe("checkout", () => {
  const base = {
    fullName: "Rahim Uddin",
    email: "rahim@example.com",
    phone: "01711111111",
    address: "House 1, Road 2",
    city: "Dhaka",
    zone: "dhaka-city",
    method: "manual-transfer" as const,
    provider: "bkash" as const,
    senderNumber: "01711111111",
  };

  it("stores the ID without a copied label", () => {
    const parsed = checkoutSchema.safeParse({ ...base, transactionId: "TrxID ABC1234XYZ" });

    expect(parsed.success && parsed.data.transactionId).toBe("ABC1234XYZ");
  });

  it("reports a label with no ID after it as a missing ID", () => {
    const parsed = checkoutSchema.safeParse({ ...base, transactionId: "TrxID" });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path.join("."))).toContain("transactionId");
  });
});

describe("adminEditPaymentDetailsRequestSchema", () => {
  const valid = {
    transactionId: "ABC1234XYZ",
    reason: "Customer messaged with a screenshot",
  };

  it("cleans the new ID the same way checkout does", () => {
    expect(
      adminEditPaymentDetailsRequestSchema.parse({
        ...valid,
        transactionId: "TrxID: ABC1234XYZ",
      }).transactionId,
    ).toBe("ABC1234XYZ");
  });

  it("needs a reason", () => {
    expect(
      adminEditPaymentDetailsRequestSchema.safeParse({ ...valid, reason: "typo" }).success,
    ).toBe(false);
  });

  it.each([
    ["+880 1615-951697", "01615951697"],
    ["01615951697", "01615951697"],
    ["০১৬১৫৯৫১৬৯৭", "01615951697"],
  ])("stores the number typed as %j as %j", (typed, stored) => {
    expect(
      adminEditPaymentDetailsRequestSchema.parse({ ...valid, senderNumber: typed }).senderNumber,
    ).toBe(stored);
  });

  it.each([undefined, "", "   "])("reads %j as no number on file", (typed) => {
    expect(
      adminEditPaymentDetailsRequestSchema.parse({ ...valid, senderNumber: typed }).senderNumber,
    ).toBeNull();
  });

  it("refuses a number that is not a Bangladeshi mobile", () => {
    const parsed = adminEditPaymentDetailsRequestSchema.safeParse({
      ...valid,
      senderNumber: "0121 555 5555",
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path.join("."))).toContain("senderNumber");
  });
});

/* -------------------------------------------------------------------------- */

const local = vi.hoisted(() => ({ holder: undefined as unknown }));

vi.mock("../../src/orders/transaction-id-claim", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/orders/transaction-id-claim")>()),
  findTransactionIdClaim: vi.fn(async () => local.holder),
}));

beforeEach(() => {
  local.holder = undefined;
});

const CONTEXT: AdminContext = {
  actor: { sub: "admin-1", sid: "s-1", role: "STAFF", email: "staff@shop.com", iat: 0, exp: 0 },
};

const REQUEST = {
  transactionId: "ABC1234XYZ",
  senderNumber: "01711111111",
  reason: "Customer messaged with a screenshot",
};

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "order-1",
  orderNumber: "SB-10482",
  status: "PENDING",
  paymentMethod: "manual-transfer",
  transactionId: "TRXIDABC1234XYZ",
  senderNumber: "01711111111",
  paymentClaimKey: "SB-10482:1",
  paymentClaimAttempts: 3,
  ...overrides,
});

function deskWith(
  order: Record<string, unknown>,
  options: { history?: unknown[]; updatedRows?: number; verifyFails?: boolean } = {},
) {
  const updates: Record<string, unknown>[] = [];
  const tx = {
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            updates.push(values);
            return Array.from({ length: options.updatedRows ?? 1 }, () => ({ id: "order-1" }));
          },
        }),
      }),
    }),
  };
  const auditRecord = vi.fn(async (entry: Record<string, unknown>) => {
    void entry;
  });
  const historyFor = vi.fn(async () => options.history ?? []);

  const service = new AdminOrdersService(
    { db: { transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)) } } as never,
    {} as never,
    {} as never,
    { record: auditRecord } as never,
    {} as never,
    { historyFor } as never,
    { get: vi.fn() } as never,
  );

  const internals = service as unknown as Record<string, () => Promise<unknown>>;
  vi.spyOn(internals, "requireOrder").mockResolvedValue(order);
  vi.spyOn(internals, "detail").mockResolvedValue({ orderNumber: "SB-10482" });
  const verify = vi.spyOn(service, "verifyPayment");
  if (options.verifyFails) verify.mockRejectedValue(new Error("gateway down"));
  else
    verify.mockResolvedValue({ record: { outcome: "NO_RECEIPT" }, summary: "", confirmed: false });

  return { service, updates, auditRecord, verify };
}

describe("editing an order's payment details", () => {
  it("saves the receipt under the next claim key, records why, and claims it", async () => {
    const { service, updates, auditRecord, verify } = deskWith(row());

    const result = await service.editPaymentDetails("SB-10482", REQUEST, CONTEXT);

    expect(updates).toEqual([
      {
        transactionId: "ABC1234XYZ",
        senderNumber: "01711111111",
        paymentClaimKey: "SB-10482:2",
        paymentClaimAttempts: 0,
        paymentClaimRetryAt: null,
      },
    ]);
    expect(auditRecord.mock.calls[0]?.[0]).toMatchObject({
      action: "TRANSACTION_ID_EDIT",
      before: {
        transactionId: "TRXIDABC1234XYZ",
        senderNumber: "01711111111",
        paymentClaimKey: "SB-10482:1",
      },
      after: {
        transactionId: "ABC1234XYZ",
        senderNumber: "01711111111",
        paymentClaimKey: "SB-10482:2",
      },
      note: REQUEST.reason,
    });
    expect(verify).toHaveBeenCalledWith("SB-10482", CONTEXT);
    expect(result.check).not.toBeNull();
  });

  it("saves a corrected sender number on its own, and re-claims under a new key", async () => {
    const { service, updates, auditRecord } = deskWith(row({ transactionId: "ABC1234XYZ" }));

    await service.editPaymentDetails(
      "SB-10482",
      { ...REQUEST, senderNumber: "01615951697" },
      CONTEXT,
    );

    expect(updates[0]).toMatchObject({
      transactionId: "ABC1234XYZ",
      senderNumber: "01615951697",
      /* Not the key the failed claim went out under: the gateway would answer
         a reused key with that first failure instead of checking again. */
      paymentClaimKey: "SB-10482:2",
      paymentClaimAttempts: 0,
    });
    expect(auditRecord.mock.calls[0]?.[0]).toMatchObject({
      before: { senderNumber: "01711111111" },
      after: { senderNumber: "01615951697" },
    });
  });

  it("fills in a number on an order that was placed without one", async () => {
    const { service, updates } = deskWith(row({ senderNumber: null }));

    await service.editPaymentDetails("SB-10482", REQUEST, CONTEXT);

    expect(updates[0]?.senderNumber).toBe("01711111111");
  });

  it("gives an order placed before claim keys existed the second key", async () => {
    const { service, updates } = deskWith(row({ paymentClaimKey: null }));

    await service.editPaymentDetails("SB-10482", REQUEST, CONTEXT);

    expect(updates[0]?.paymentClaimKey).toBe("SB-10482:2");
  });

  it("keeps the edit when the claim afterwards fails", async () => {
    const { service, updates } = deskWith(row(), { verifyFails: true });

    const result = await service.editPaymentDetails("SB-10482", REQUEST, CONTEXT);

    expect(updates).toHaveLength(1);
    expect(result.check).toBeNull();
  });

  it.each([
    ["a confirmed order", row({ status: "PAYMENT_CONFIRMED" })],
    ["a cancelled order", row({ status: "CANCELLED" })],
    ["cash on delivery", row({ paymentMethod: "cash-on-delivery", transactionId: null })],
    ["the same ID and number, the ID typed differently", row({ transactionId: "abc-1234-xyz" })],
  ])("refuses %s", async (_label, order) => {
    const { service, updates } = deskWith(order);

    await expect(service.editPaymentDetails("SB-10482", REQUEST, CONTEXT)).rejects.toBeInstanceOf(
      InvalidInputError,
    );
    expect(updates).toHaveLength(0);
  });

  it("refuses while the order holds a payment at the gateway", async () => {
    const { service, updates } = deskWith(row(), {
      history: [{ outcome: "CLAIMED", checkedAt: "2026-10-21T08:00:00.000Z", transactionId: "X1" }],
    });

    await expect(service.editPaymentDetails("SB-10482", REQUEST, CONTEXT)).rejects.toThrow(
      /holds payment X1/,
    );
    expect(updates).toHaveLength(0);
  });

  it("refuses an ID another of our orders already holds, and names it", async () => {
    local.holder = { orderNumber: "SB-10001", status: "PENDING", createdAt: new Date() };
    const { service, updates } = deskWith(row());

    await expect(service.editPaymentDetails("SB-10482", REQUEST, CONTEXT)).rejects.toThrow(
      /SB-10001/,
    );
    expect(updates).toHaveLength(0);
  });

  it("does not claim when the order stopped being pending mid-edit", async () => {
    const { service, auditRecord, verify } = deskWith(row(), { updatedRows: 0 });

    await expect(service.editPaymentDetails("SB-10482", REQUEST, CONTEXT)).rejects.toThrow(
      /no longer pending/,
    );
    expect(auditRecord).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });
});
