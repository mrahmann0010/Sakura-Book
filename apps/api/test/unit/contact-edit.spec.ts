import { adminEditOrderContactRequestSchema } from "@sakura/contracts";
import { describe, expect, it, vi } from "vitest";
import { AdminOrdersService, type AdminContext } from "../../src/admin/orders/admin-orders.service";
import { InvalidInputError } from "../../src/common/errors";

/**
 * Correcting the delivery details a customer typed wrong at checkout.
 *
 * The two things worth pinning down are what the edit must not disturb — the
 * zone and everything priced off it — and that a finished order's address
 * stays the record of where the parcel went.
 */

const CONTEXT: AdminContext = {
  actor: { sub: "admin-1", sid: "s-1", role: "STAFF", email: "staff@shop.com", iat: 0, exp: 0 },
};

const REQUEST = adminEditOrderContactRequestSchema.parse({
  fullName: "Rahim Uddin",
  email: "rahim@example.com",
  phone: "01711111112",
  secondaryPhone: "",
  address: "House 1, Road 2, Flat 4B",
  city: "Dhaka",
  upazila: "Gulshan",
  area: "Badda",
  postCode: "1212",
  customerNote: "",
  reason: "Customer rang: phone was missing a digit and the flat number was left off.",
});

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "order-1",
  orderNumber: "SB-10482",
  status: "PENDING",
  customerName: "Rahim Uddin",
  customerEmail: "rahim@example.com",
  customerPhone: "01711111111",
  customerSecondaryPhone: "01999999999",
  customerNote: "Leave at the gate",
  shippingAddress: {
    address: "House 1, Road 2",
    city: "Dhaka",
    region: "inside-dhaka",
    zone: "dhaka-city",
    tier: "inside-dhaka",
    parcelWeightGrams: 249,
  },
  ...overrides,
});

function deskWith(order: Record<string, unknown>) {
  const updates: Record<string, unknown>[] = [];
  const tx = {
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push(values);
        },
      }),
    }),
  };
  const auditRecord = vi.fn(async (entry: Record<string, unknown>) => {
    void entry;
  });

  const service = new AdminOrdersService(
    { db: { transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)) } } as never,
    {} as never,
    {} as never,
    { record: auditRecord } as never,
    {} as never,
    { historyFor: vi.fn(async () => []) } as never,
    { get: vi.fn() } as never,
  );

  const internals = service as unknown as Record<string, () => Promise<unknown>>;
  vi.spyOn(internals, "requireOrder").mockResolvedValue(order);
  vi.spyOn(internals, "detail").mockResolvedValue({ orderNumber: "SB-10482" });

  return { service, updates, auditRecord };
}

describe("adminEditOrderContactRequestSchema", () => {
  it("needs a reason", () => {
    expect(
      adminEditOrderContactRequestSchema.safeParse({ ...REQUEST, reason: "typo" }).success,
    ).toBe(false);
  });

  it("has no zone field: re-pricing is not a correction", () => {
    const parsed = adminEditOrderContactRequestSchema.parse({
      ...REQUEST,
      zone: "chattogram-city",
    });

    expect(parsed).not.toHaveProperty("zone");
  });
});

describe("editing an order's delivery details", () => {
  it("saves the new details and records what they were", async () => {
    const { service, updates, auditRecord } = deskWith(row());

    await service.editContactDetails("SB-10482", REQUEST, CONTEXT);

    expect(updates[0]).toMatchObject({
      customerName: "Rahim Uddin",
      customerPhone: "01711111112",
      customerNote: null,
      // Cleared rather than left at the old number: empty means there is none.
      customerSecondaryPhone: null,
    });
    expect(auditRecord.mock.calls[0]?.[0]).toMatchObject({
      action: "CONTACT_EDIT",
      before: { customerPhone: "01711111111", customerSecondaryPhone: "01999999999" },
      after: { customerPhone: "01711111112" },
      note: REQUEST.reason,
    });
  });

  it("carries the zone and what was priced off it through untouched", async () => {
    const { service, updates } = deskWith(row());

    await service.editContactDetails("SB-10482", REQUEST, CONTEXT);

    expect(updates[0]?.shippingAddress).toEqual({
      address: "House 1, Road 2, Flat 4B",
      city: "Dhaka",
      upazila: "Gulshan",
      area: "Badda",
      postCode: "1212",
      region: "inside-dhaka",
      zone: "dhaka-city",
      tier: "inside-dhaka",
      parcelWeightGrams: 249,
    });
  });

  it.each(["DELIVERED", "CANCELLED", "REFUNDED"])("refuses a %s order", async (status) => {
    const { service, updates } = deskWith(row({ status }));

    await expect(service.editContactDetails("SB-10482", REQUEST, CONTEXT)).rejects.toBeInstanceOf(
      InvalidInputError,
    );
    expect(updates).toHaveLength(0);
  });

  it("refuses a save that changes nothing", async () => {
    const unchanged = adminEditOrderContactRequestSchema.parse({
      ...REQUEST,
      phone: "01711111111",
      secondaryPhone: "01999999999",
      address: "House 1, Road 2",
      upazila: "",
      area: "",
      postCode: "",
      customerNote: "Leave at the gate",
    });
    const { service, updates } = deskWith(row());

    await expect(service.editContactDetails("SB-10482", unchanged, CONTEXT)).rejects.toThrow(
      /Nothing was changed/,
    );
    expect(updates).toHaveLength(0);
  });
});
