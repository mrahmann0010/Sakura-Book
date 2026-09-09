import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminWaitlistInviteService } from "../../src/admin/waitlist/admin-waitlist-invite.service";
import { SmsGatewayUnreachableError, SmsService } from "../../src/sms";

/**
 * What makes a bulk invite survive its own failures.
 *
 * The three properties pinned here are the ones a restock morning depends on
 * and that nothing else in the suite covers:
 *
 *   1. A single gateway call is bounded, so one asleep phone cannot stall
 *      every recipient queued behind it.
 *   2. Every attempt — success *and* failure — is written to the entry
 *      before the response is built, so a closed tab does not take the list
 *      of who to retry with it.
 *   3. Sends overlap, so a batch does not cost the sum of its latencies.
 *
 * The first is a property of SmsService; the last two of the invite service.
 */

/* -------------------------------------------------------------------------- */

describe("SmsService.send — bounded gateway call", () => {
  afterEach(() => vi.unstubAllGlobals());

  function service(timeoutMs = 10_000) {
    const config = {
      get: (key: string) =>
        ({
          SMS_GATEWAY_URL: "http://phone.local/api/mobile/v1",
          SMS_GATEWAY_USERNAME: "user",
          SMS_GATEWAY_PASSWORD: "pass",
          SMS_GATEWAY_TIMEOUT_MS: timeoutMs,
        })[key],
    };

    return new SmsService(config as never, { simNumber: async () => null } as never);
  }

  it("passes an abort signal, so the call cannot hang forever", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await service().send("01700000000", "hello");

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("turns a timed-out call into a domain error naming the timeout", async () => {
    // What AbortSignal.timeout produces when it fires.
    const timeout = Object.assign(new Error("The operation was aborted"), {
      name: "TimeoutError",
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeout));

    await expect(service(2500).send("01700000000", "hello")).rejects.toBeInstanceOf(
      SmsGatewayUnreachableError,
    );
    await expect(service(2500).send("01700000000", "hello")).rejects.toThrow(/2500ms/);
  });

  it("turns a refused connection into the same domain error, not a raw TypeError", async () => {
    // An unwrapped fetch rejection would escape the caller's "SMS is
    // best-effort" catch and take down the request around it.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    await expect(service().send("01700000000", "hello")).rejects.toBeInstanceOf(
      SmsGatewayUnreachableError,
    );
  });
});

/* -------------------------------------------------------------------------- */

type Entry = {
  id: string;
  status: "PENDING" | "NOTIFIED" | "CONVERTED" | "CANCELLED";
  bookId: string | null;
  quantity: number;
  locale: string;
  customerPhone: string;
};

function entry(id: string, overrides: Partial<Entry> = {}): Entry {
  return {
    id,
    status: "PENDING",
    bookId: null,
    quantity: 1,
    locale: "bn",
    customerPhone: `0170000000${id}`,
    ...overrides,
  };
}

/**
 * Captures every `update(...).set(...)` the service issues, so a test can
 * assert on what was persisted rather than only on what was returned — the
 * whole point of the delivery columns being that the two can differ.
 */
function fakeDeps(entries: Entry[]) {
  const writes: { id: string; values: Record<string, unknown> }[] = [];

  const dbService = {
    db: {
      query: { waitlistEntries: { findMany: vi.fn().mockResolvedValue(entries) } },
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: (condition: unknown) => {
            // The fake carries no SQL engine; the id is recovered from the
            // equality fragment drizzle built.
            const id = String(
              (condition as { queryChunks?: unknown[] })?.queryChunks?.find(
                (chunk) => typeof chunk === "object" && chunk !== null && "value" in chunk,
              ) ?? "",
            );
            writes.push({ id, values });
            return Promise.resolve();
          },
        }),
      }),
    },
  };

  return { dbService, writes };
}

function makeService(entries: Entry[], sendInviteLink: SmsService["sendInviteLink"]) {
  const { dbService, writes } = fakeDeps(entries);

  const inviteService = {
    issue: vi
      .fn()
      .mockImplementation(async (id: string) => ({
        token: `tok_${id}`,
        expiresAt: new Date(Date.now() + 3_600_000),
      })),
  };

  const service = new AdminWaitlistInviteService(
    dbService as never,
    inviteService as never,
    { ttlHours: async () => 48, language: async () => "customer" } as never,
    { sendInviteLink } as never,
    { recordDetached: vi.fn().mockResolvedValue(undefined) } as never,
    { get: () => "https://shop.example" } as never,
  );

  return { service, writes };
}

const context = {
  actor: { sub: "admin-1", email: "staff@example.com" },
  ipAddress: null,
  userAgent: null,
} as never;

describe("AdminWaitlistInviteService.invite — durable outcomes", () => {
  it("records a FAILED delivery with the gateway's reason, not just in the response", async () => {
    const ids = ["1", "2", "3"];
    const { service, writes } = makeService(
      ids.map((id) => entry(id)),
      vi.fn().mockImplementation(async (phone: string) => {
        if (phone.endsWith("2")) throw new Error("phone is offline");
      }) as never,
    );

    const result = await service.invite({ ids }, context);

    // The response still tells the truth...
    expect(result.results.map((row) => row.sent)).toEqual([true, false, true]);

    // ...but so does the database, which is what outlives a dropped request.
    const failure = writes.find((write) => write.values.inviteSmsStatus === "FAILED");
    expect(failure).toBeDefined();
    expect(failure!.values.inviteSmsError).toContain("phone is offline");
    expect(writes.filter((write) => write.values.inviteSmsStatus === "SENT")).toHaveLength(2);
  });

  it("leaves a failed entry PENDING, so it is still in the next batch to retry", async () => {
    const { service, writes } = makeService(
      [entry("1")],
      vi.fn().mockRejectedValue(new Error("gateway down")) as never,
    );

    await service.invite({ ids: ["1"] }, context);

    // Nothing claimed this person was reached.
    expect(writes.some((write) => write.values.status === "NOTIFIED")).toBe(false);
  });

  it("keeps outcomes in the order staff selected, though sends finish out of order", async () => {
    const ids = ["1", "2", "3", "4", "5", "6"];
    // Later ids resolve first, so append-order would scramble the response.
    const { service } = makeService(
      ids.map((id) => entry(id)),
      vi.fn().mockImplementation(async (phone: string) => {
        const position = Number(phone.slice(-1));
        await new Promise((resolve) => setTimeout(resolve, (ids.length - position) * 5));
        if (position === 3) throw new Error("nope");
      }) as never,
    );

    const result = await service.invite({ ids }, context);

    expect(result.results.map((row) => row.id)).toEqual(ids);
    expect(result.results[2]!.sent).toBe(false);
  });

  it("overlaps sends rather than waiting for each in turn", async () => {
    const ids = Array.from({ length: 10 }, (_, index) => String(index));
    let inFlight = 0;
    let peak = 0;

    const { service } = makeService(
      ids.map((id) => entry(id)),
      vi.fn().mockImplementation(async () => {
        peak = Math.max(peak, ++inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight--;
      }) as never,
    );

    await service.invite({ ids }, context);

    // Serial would peak at 1. The pool is capped, so this is a range, not a
    // count — the assertion is "concurrent but bounded", which is the property
    // that matters to a single-SIM gateway.
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(5);
  });

  it("does not mint a token or send for an entry that cancelled or already ordered", async () => {
    const sendInviteLink = vi.fn().mockResolvedValue(undefined);
    const { service } = makeService(
      [entry("1", { status: "CANCELLED" }), entry("2", { status: "CONVERTED" })],
      sendInviteLink as never,
    );

    const result = await service.invite({ ids: ["1", "2"] }, context);

    expect(sendInviteLink).not.toHaveBeenCalled();
    expect(result.results.every((row) => row.error === "Not eligible.")).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */

/**
 * Promises are capped by copies.
 *
 * A print run smaller than its waitlist is the normal case here, not an edge
 * one — sixty copies against three hundred people waiting — so "who gets a
 * link" is a rationing decision, and it has to be made before the texts go out
 * rather than discovered by the two hundred and fortieth person at checkout.
 *
 * `spare` in these fakes is what the real query computes: stock, less the
 * copies held by live invites belonging to entries outside this batch.
 */
function makeCappedService(entries: Entry[], spare: Record<string, number>) {
  const { dbService } = fakeDeps(entries);
  const sendInviteLink = vi.fn().mockResolvedValue(undefined);

  Object.assign(dbService.db, {
    select: () => ({
      from: () => ({
        where: () =>
          Promise.resolve(Object.entries(spare).map(([id, value]) => ({ id, spare: value }))),
      }),
    }),
  });

  const service = new AdminWaitlistInviteService(
    dbService as never,
    {
      issue: vi.fn().mockImplementation(async (id: string) => ({
        token: `tok_${id}`,
        expiresAt: new Date(Date.now() + 3_600_000),
      })),
    } as never,
    { ttlHours: async () => 48, language: async () => "customer" } as never,
    { sendInviteLink } as never,
    { recordDetached: vi.fn().mockResolvedValue(undefined) } as never,
    { get: () => "https://shop.example" } as never,
  );

  return { service, sendInviteLink };
}

describe("AdminWaitlistInviteService.invite — never promises more copies than exist", () => {
  it("refuses the entries past the last unreserved copy, and texts nobody about them", async () => {
    const { service, sendInviteLink } = makeCappedService(
      ["1", "2", "3"].map((id) => entry(id, { bookId: "book-a" })),
      { "book-a": 2 },
    );

    const result = await service.invite({ ids: ["1", "2", "3"] }, context);

    expect(result.results[0]!.error).toBeUndefined();
    expect(result.results[1]!.error).toBeUndefined();
    expect(result.results[2]!.error).toMatch(/No unreserved copies left/);

    // The refusal is worth nothing if the SMS still went — that is the cost
    // this cap exists to avoid, on top of the false promise.
    expect(sendInviteLink).toHaveBeenCalledTimes(2);
  });

  it("spends the copies in the order staff selected, so the longest wait is served first", async () => {
    const { service } = makeCappedService(
      ["first", "second"].map((id) => entry(id, { bookId: "book-a" })),
      { "book-a": 1 },
    );

    const result = await service.invite({ ids: ["first", "second"] }, context);

    expect(result.results[0]!.error).toBeUndefined();
    expect(result.results[1]!.error).toBeDefined();
  });

  it("counts an entry's whole quantity, not one copy per person", async () => {
    // Two people asking for two copies each is four copies off a three-copy
    // run — the second must not fit just because it is only the second person.
    const { service } = makeCappedService(
      ["1", "2"].map((id) => entry(id, { bookId: "book-a", quantity: 2 })),
      { "book-a": 3 },
    );

    const result = await service.invite({ ids: ["1", "2"] }, context);

    expect(result.results[0]!.error).toBeUndefined();
    expect(result.results[1]!.error).toMatch(/Only 1 unreserved copy left/);
  });

  it("caps each title separately rather than sharing one budget", async () => {
    const { service } = makeCappedService(
      [entry("1", { bookId: "book-a" }), entry("2", { bookId: "book-b" })],
      { "book-a": 0, "book-b": 5 },
    );

    const result = await service.invite({ ids: ["1", "2"] }, context);

    expect(result.results[0]!.error).toBeDefined();
    expect(result.results[1]!.error).toBeUndefined();
  });

  it("leaves OPEN invites uncapped, since they reserve no particular book", async () => {
    // bookId null — the general restock list. There is nothing to run out of.
    const { service, sendInviteLink } = makeCappedService(
      ["1", "2", "3"].map((id) => entry(id)),
      {},
    );

    const result = await service.invite({ ids: ["1", "2", "3"] }, context);

    expect(result.results.every((row) => row.error === undefined)).toBe(true);
    expect(sendInviteLink).toHaveBeenCalledTimes(3);
  });
});
