import { describe, expect, it, vi } from "vitest";
import { AdminWaitlistService } from "../../src/admin/waitlist/admin-waitlist.service";

/**
 * Cancelling takes the invite back.
 *
 * `inventory/reservations.ts` holds a copy for exactly as long as its token
 * could still be spent, and reads no `status` at all — deliberately, because
 * status describes how far the conversation with a customer got, not whether
 * a copy is still owed. The consequence is that CANCELLED on its own changes
 * nothing the shop can see: the entry keeps its live token, `consume` keeps
 * accepting it, and the copies stay off the shelf until the TTL lapses. Staff
 * pressing Cancel are told it worked while none of it is true.
 *
 * These pin the two halves of the repair — that the revoke happens, and that
 * it commits with the status change rather than beside it.
 */

function fakeRow(status: string) {
  return {
    id: "e1",
    bookTitleSnapshot: "N5 Kanji Book",
    customerName: "Mina",
    customerEmail: "mina@example.com",
    customerPhone: "+8801700000000",
    quantity: 2,
    locale: "bn",
    source: "restock-notify-page",
    status,
    notifiedAt: null,
    internalNote: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    convertedOrderNumber: null,
    inviteSmsStatus: null,
    inviteSmsError: null,
    inviteSmsAt: null,
    inviteMode: null,
    inviteExpiresAt: null,
    inviteUsedAt: null,
  };
}

function makeService(existingStatus = "NOTIFIED") {
  /* Records the order writes were issued in, and whether each was inside the
     transaction — the second question being the point of one of the tests
     below. */
  const calls: { what: string; inTx: boolean }[] = [];
  let inTx = false;

  const writer = (what: string) => ({
    set: () => ({
      where: () => {
        calls.push({ what, inTx });
        return Promise.resolve();
      },
    }),
  });

  const db = {
    query: {
      waitlistEntries: {
        findFirst: vi.fn().mockResolvedValue({
          id: "e1",
          status: existingStatus,
          internalNote: null,
        }),
      },
    },
    update: () => writer("status"),
    select: () => ({
      from: () => ({
        leftJoin: () => ({ where: () => Promise.resolve([fakeRow("CANCELLED")]) }),
      }),
    }),
    transaction: async (callback: (tx: unknown) => Promise<void>) => {
      inTx = true;
      try {
        await callback({ update: () => writer("status") });
      } finally {
        inTx = false;
      }
    },
  };

  const revoke = vi.fn().mockImplementation(async () => {
    calls.push({ what: "revoke", inTx });
  });

  const service = new AdminWaitlistService(
    { db } as never,
    { recordDetached: vi.fn().mockResolvedValue(undefined) } as never,
    { revoke } as never,
  );

  return { service, revoke, calls };
}

const context = {
  actor: { sub: "admin-1", email: "staff@example.com" },
  ipAddress: null,
  userAgent: null,
} as never;

describe("AdminWaitlistService.update — cancelling revokes the invite", () => {
  it("takes back the unspent token when an entry is cancelled", async () => {
    const { service, revoke } = makeService();

    await service.update("e1", { status: "CANCELLED" }, context);

    expect(revoke).toHaveBeenCalledWith("e1", expect.anything());
  });

  it("revokes in the same transaction as the status change", async () => {
    // Committing the status alone would be the same bug with a smaller
    // window: an entry that reads CANCELLED while its link still works.
    const { service, calls } = makeService();

    await service.update("e1", { status: "CANCELLED" }, context);

    expect(calls.map((call) => call.what)).toEqual(["status", "revoke"]);
    expect(calls.every((call) => call.inTx)).toBe(true);
  });

  it("cancels from PENDING too, where there is simply nothing to take back", async () => {
    // Asking which status it came from would only add a branch that has to
    // stay right; `revoke` is a no-op on an entry that was never invited.
    const { service, revoke } = makeService("PENDING");

    await service.update("e1", { status: "CANCELLED" }, context);

    expect(revoke).toHaveBeenCalledOnce();
  });

  it("leaves invites alone for every other edit", async () => {
    // A note, or a move to NOTIFIED, must not destroy a live link — the
    // customer is still expected to use it.
    const { service, revoke } = makeService();

    await service.update("e1", { internalNote: "Called, no answer." }, context);
    await service.update("e1", { status: "NOTIFIED" }, context);

    expect(revoke).not.toHaveBeenCalled();
  });
});
