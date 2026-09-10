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
    issue: vi.fn().mockImplementation(async (id: string) => ({
      token: `tok_${id}`,
      expiresAt: new Date(Date.now() + 3_600_000),
    })),
  };

  const service = new AdminWaitlistInviteService(
    dbService as never,
    inviteService as never,
    { ttlHours: async () => 48, language: async () => "customer" } as never,
    /* No book on these entries, so nothing consults a release. The empty map
       is what the real service returns for an empty book list. */
    { spendableByBook: async () => new Map() } as never,
    { sendInviteLink } as never,
    { recordDetached: vi.fn().mockResolvedValue(undefined) } as never,
    { get: () => "https://shop.example" } as never,
  );

  return { service, writes, issue: inviteService.issue };
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
 * Promises are capped by the release, not by the print run.
 *
 * A print run smaller than its waitlist is the normal case here, not an edge
 * one — sixty copies against three hundred people waiting — so "who gets a
 * link" is a rationing decision, and it has to be made before the texts go out
 * rather than discovered by the two hundred and fortieth person at checkout.
 *
 * `spendable` in these fakes is what `WaitlistAllocationService` computes: the
 * smaller of what this release has left and what physically exists unheld,
 * with the entries in this batch excluded from both. A book **absent** from
 * the record has no open release, which is a refusal rather than a zero — the
 * distinction the last test in this block pins down.
 */
/** What `spendableByBook` hands back for one book, when a test needs to say
 *  which of the three limits is biting rather than just the total. */
type Budget = {
  spendable: number;
  copies: number;
  committed: number;
  physicalSpare: number;
};

function makeCappedService(
  entries: Entry[],
  spendable: Record<string, number | Budget>,
  holding: string[] = [],
) {
  const { dbService } = fakeDeps(entries);
  const sendInviteLink = vi.fn().mockResolvedValue(undefined);

  /* Only one read still goes through `select` in this path: which of these
     entries is already holding a live invite. The capacity question moved to
     the allocation service below. */
  Object.assign(dbService.db, {
    select: () => ({
      from: () => ({ where: () => Promise.resolve(holding.map((id) => ({ id }))) }),
    }),
  });

  const issue = vi.fn().mockImplementation(async (id: string) => ({
    token: `tok_${id}`,
    expiresAt: new Date(Date.now() + 3_600_000),
  }));

  /* The full record the real service returns, not just `spendable`.

     The three limits behind that number are what a refusal reads to say which
     one bit — a release that sold through and a shelf that is empty both
     produce zero and need opposite actions from a human. A stub carrying only
     the total let those branches pass by accident on `undefined`, which is
     precisely how the wrong sentence reached the panel. */
  const spendableByBook = vi.fn().mockImplementation(
    async () =>
      new Map(
        Object.entries(spendable).map(([bookId, value]) => [
          bookId,
          {
            allocationId: `alloc_${bookId}`,
            ...(typeof value === "number"
              ? /* A bare number means "a healthy release with this much left":
                   nothing committed yet, and plenty on the shelf. The cases
                   that are not healthy say so explicitly. */
                { spendable: value, copies: value, committed: 0, physicalSpare: value + 50 }
              : value),
          },
        ]),
      ),
  );

  const service = new AdminWaitlistInviteService(
    dbService as never,
    { issue } as never,
    { ttlHours: async () => 48, language: async () => "customer" } as never,
    { spendableByBook } as never,
    { sendInviteLink } as never,
    { recordDetached: vi.fn().mockResolvedValue(undefined) } as never,
    { get: () => "https://shop.example" } as never,
  );

  return { service, sendInviteLink, issue, spendableByBook };
}

describe("AdminWaitlistInviteService.invite — never promises more copies than the release holds", () => {
  it("refuses the entries past the last unreserved copy, and texts nobody about them", async () => {
    const { service, sendInviteLink } = makeCappedService(
      ["1", "2", "3"].map((id) => entry(id, { bookId: "book-a" })),
      { "book-a": 2 },
    );

    const result = await service.invite({ ids: ["1", "2", "3"] }, context);

    expect(result.results[0]!.error).toBeUndefined();
    expect(result.results[1]!.error).toBeUndefined();
    expect(result.results[2]!.error).toMatch(/fully spoken for/);

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
    expect(result.results[1]!.error).toMatch(/Only 1 copy left in this release/);
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

  /**
   * The budget must not grow when an entry is refused.
   *
   * `spare` is computed with every entry in the batch excluded from the
   * reserved count — a loan against the assumption that each of them is about
   * to have its token rewritten. A *refused* entry has nothing rewritten: its
   * existing invite stands and its copies stay held. Charging it back is what
   * keeps the refusal branch from funding the entries behind it with copies
   * that are already promised.
   */
  it("keeps a refused entry's existing reservation charged against the book", async () => {
    // Five copies unclaimed by anyone outside this batch. Entry "1" asks for
    // six and is already holding a live invite for those six — a stock count
    // lowered under it. Its renewal is refused, but the six copies it holds do
    // not come back just because the renewal did not go through, so entry "2"
    // must be refused too rather than served from the gap.
    const { service, sendInviteLink } = makeCappedService(
      [
        entry("1", { bookId: "book-a", quantity: 6 }),
        entry("2", { bookId: "book-a", quantity: 3 }),
      ],
      { "book-a": 5 },
      ["1"],
    );

    const result = await service.invite({ ids: ["1", "2"] }, context);

    expect(result.results[0]!.error).toMatch(/Only 5 copies left in this release/);
    expect(result.results[1]!.error).toMatch(/fully spoken for/);
    expect(sendInviteLink).not.toHaveBeenCalled();
  });

  it("does not charge back an entry whose invite has lapsed or was never issued", async () => {
    // Same shape, but entry "1" holds nothing — a lapsed invite has already
    // returned its copies. All five are genuinely free, so entry "2" fits.
    const { service } = makeCappedService(
      [
        entry("1", { bookId: "book-a", quantity: 6 }),
        entry("2", { bookId: "book-a", quantity: 3 }),
      ],
      { "book-a": 5 },
      [],
    );

    const result = await service.invite({ ids: ["1", "2"] }, context);

    expect(result.results[0]!.error).toBeDefined();
    expect(result.results[1]!.error).toBeUndefined();
  });

  it("refuses everyone once refusals have driven the book over-issued", async () => {
    // Two entries each holding three copies of a two-copy run — an admin
    // lowered the stock count under live invites. Neither renewal fits, and
    // the arithmetic must not hand the shortfall to the third entry.
    const { service, sendInviteLink } = makeCappedService(
      [
        entry("1", { bookId: "book-a", quantity: 3 }),
        entry("2", { bookId: "book-a", quantity: 3 }),
        entry("3", { bookId: "book-a", quantity: 1 }),
      ],
      { "book-a": 2 },
      ["1", "2"],
    );

    const result = await service.invite({ ids: ["1", "2", "3"] }, context);

    expect(result.results.every((row) => row.error !== undefined)).toBe(true);
    expect(sendInviteLink).not.toHaveBeenCalled();
  });

  /**
   * No open release is a refusal, not a fallback.
   *
   * This is the whole point of allocations. Before them the budget was the
   * print run, so a long queue could hold every copy and a walk-in customer
   * saw "sold out" for the length of the window. If an absent release quietly
   * meant "use physical stock", that behaviour would come straight back — and
   * silently, because the batch would send, the copies would go, and nothing
   * would say which budget paid for them.
   */
  it("refuses a book with no open release rather than falling back to stock", async () => {
    const { service, sendInviteLink } = makeCappedService(
      ["1", "2"].map((id) => entry(id, { bookId: "book-a" })),
      // book-a absent: plenty of physical stock, but nobody has decided how
      // much of it is the waitlist's.
      {},
    );

    const result = await service.invite({ ids: ["1", "2"] }, context);

    expect(result.results.every((row) => row.error?.match(/No open stock release/))).toBe(true);
    expect(sendInviteLink).not.toHaveBeenCalled();
  });

  it("charges each issued invite to the release that funded it", async () => {
    // Without this the hold exists and no release accounts for it, so the
    // budget it was checked against reports the copies as still available and
    // hands them out again.
    const { service, issue } = makeCappedService([entry("1", { bookId: "book-a" })], {
      "book-a": 5,
    });

    await service.invite({ ids: ["1"] }, context);

    expect(issue).toHaveBeenCalledWith("1", 48, "LOCKED", "alloc_book-a", null);
  });

  it("excludes the batch's own entries from the budget it is measured against", async () => {
    // A re-invite rewrites the token on the existing row rather than adding
    // one. Counting the old reservation and then charging for the new one
    // would bill the same person's copies twice and refuse a batch that fits.
    const { service, spendableByBook } = makeCappedService(
      ["1", "2"].map((id) => entry(id, { bookId: "book-a" })),
      { "book-a": 2 },
    );

    await service.invite({ ids: ["1", "2"] }, context);

    expect(spendableByBook).toHaveBeenCalledWith(["book-a"], { excludeEntryIds: ["1", "2"] });
  });

  it("leaves OPEN invites uncapped and charged to no release", async () => {
    // bookId null — the general restock list. An OPEN invite names no book, so
    // it reserves nothing, there is nothing to run out of, and there is no
    // release to charge. Note this is the one case where an absent entry in
    // the budget record is *not* a refusal: these never reach that check.
    const { service, sendInviteLink, issue } = makeCappedService(
      ["1", "2", "3"].map((id) => entry(id)),
      {},
    );

    const result = await service.invite({ ids: ["1", "2", "3"] }, context);

    expect(result.results.every((row) => row.error === undefined)).toBe(true);
    expect(sendInviteLink).toHaveBeenCalledTimes(3);
    expect(issue).toHaveBeenCalledWith("1", 48, "OPEN", null, null);
  });
});

describe("AdminWaitlistInviteService.invite — telling apart the three ways of having nothing", () => {
  it("tells staff to start a new release when this one has sold through", async () => {
    /* The trap, in full: stock one, share one, invite one person, they buy.
       Restock and set the share to one again and nothing happens — a copy that
       sells stays charged to the release that sold it, so the release never
       refills and the number was never what was wrong. The old wording ("this
       release is fully spoken for. Wait for an invite to lapse, or allocate
       more copies") described none of that, and every action it suggested was
       one that could not work: nothing was going to lapse, and allocating more
       to the same release is what they had just tried. */
    const { service, sendInviteLink } = makeCappedService([entry("1", { bookId: "book-a" })], {
      "book-a": { spendable: 0, copies: 1, committed: 1, physicalSpare: 1 },
    });

    const result = await service.invite({ ids: ["1"] }, context);

    expect(result.results[0]!.error).toMatch(/Close this release and open a new one/);
    expect(sendInviteLink).not.toHaveBeenCalled();
  });

  it("says to add stock when the release is spent and the shelf is bare too", async () => {
    // Closing the release would achieve nothing here — its successor would
    // open with no copies to give. The delivery is the thing that has to
    // happen first, so that is what the sentence asks for.
    const { service } = makeCappedService([entry("1", { bookId: "book-a" })], {
      "book-a": { spendable: 0, copies: 4, committed: 4, physicalSpare: 0 },
    });

    const result = await service.invite({ ids: ["1"] }, context);

    expect(result.results[0]!.error).toMatch(/Add stock, then open a new release/);
  });

  it("blames the shelf, not the release, when the budget is intact and the books are gone", async () => {
    // The release has three copies left to give and the shop has none to give.
    // Opening another release would promise thin air.
    const { service } = makeCappedService([entry("1", { bookId: "book-a" })], {
      "book-a": { spendable: 0, copies: 10, committed: 7, physicalSpare: 0 },
    });

    const result = await service.invite({ ids: ["1"] }, context);

    expect(result.results[0]!.error).toMatch(/No copies left on the shelf/);
  });

  it("does not tell staff to close a healthy release their own batch just emptied", async () => {
    /* The regression this pair of branches has to avoid. Entry one takes the
       release's last two copies; entry two is refused because of it. The
       release was fine a moment ago and is now holding copies for somebody who
       has just been texted — closing it would be the worst available advice. */
    const { service } = makeCappedService(
      [entry("1", { bookId: "book-a", quantity: 2 }), entry("2", { bookId: "book-a" })],
      { "book-a": { spendable: 2, copies: 2, committed: 0, physicalSpare: 40 } },
    );

    const result = await service.invite({ ids: ["1", "2"] }, context);

    expect(result.results[1]!.error).toMatch(/fully spoken for/);
    expect(result.results[1]!.error).not.toMatch(/Close this release/);
  });
});
