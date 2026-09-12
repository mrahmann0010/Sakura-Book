import type { PlaceOrderRequest } from "@sakura/contracts";
import { describe, expect, it, vi } from "vitest";
import { waitlistEntries } from "../../src/db/schema";
import { CheckoutService } from "../../src/orders/checkout.service";
import { WaitlistInviteMismatchError } from "../../src/orders/order.errors";
import { WaitlistFulfillmentService } from "../../src/waitlist/waitlist-fulfillment.service";
import { WaitlistInviteService } from "../../src/waitlist/waitlist-invite.service";

/**
 * An invite that becomes an order has to say so on the waitlist entry.
 *
 * The bug this pins down was silent in exactly the way the receipt bug was:
 * checkout spent the token, stamped `invite_used_at`, and threw away the
 * entry id `consume` handed back. Every customer who actually bought stayed
 * in NOTIFIED with an empty `converted_order_id`, indistinguishable on the
 * waitlist desk from the ones who ignored the SMS — so "we sent 200 invites,
 * how many converted?" had no answer short of matching phone numbers by hand.
 *
 * Both writes belong to the order's own transaction, so these drive
 * `writeOrder` through a fake `tx` and assert on what it was asked to write:
 * spending the token and linking the order are two statements on one handle,
 * and either both commit or neither does.
 */

const ORDER_ID = "order-1";
const ENTRY_ID = "entry-1";

/**
 * A `tx` that records statements instead of running them.
 *
 * `where()` is both awaitable and `.returning()`-able because the two updates
 * under test differ: `consume` reads its row back, `markConverted` does not.
 */
function fakeTx(consumed: unknown[]) {
  const updates: { table: unknown; values: Record<string, unknown> }[] = [];
  const inserts: { table: unknown; values: unknown }[] = [];

  const update = (table: unknown) => ({
    set: (values: Record<string, unknown>) => {
      updates.push({ table, values });

      const result = {
        returning: () => Promise.resolve(consumed),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
      };

      return { where: () => result };
    },
  });

  const insert = (table: unknown) => ({
    values: (values: unknown) => {
      inserts.push({ table, values });

      return {
        returning: () => Promise.resolve([{ id: ORDER_ID }]),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
      };
    },
  });

  const tx = {
    update,
    insert,
    // insertOrder wraps its INSERT in a savepoint so an order-number collision
    // can be retried; nothing here collides, so this just runs the callback.
    transaction: (fn: (savepoint: unknown) => unknown) => fn(tx),
  };

  return { tx: tx as never, updates, inserts };
}

/** COD deliberately: no receipt means `rejectReusedTransactionId` reads nothing. */
function request(items = [{ bookId: "book-1", quantity: 2 }]): PlaceOrderRequest {
  return {
    items,
    customer: {
      fullName: "Mina",
      email: "mina@example.com",
      phone: "01700000000",
      address: "12 Road 4",
      city: "Dhaka",
      region: "dhaka",
      method: "cash-on-delivery",
    },
    inviteToken: "tok_abc",
  } as PlaceOrderRequest;
}

function checkoutService(inviteService: WaitlistInviteService) {
  const priced = {
    lines: [
      {
        bookId: "book-1",
        quantity: 2,
        title: "N5 Kanji Book",
        authors: [],
        unitPriceCents: 50_000,
      },
    ],
    rejected: [],
    subtotalCents: 100_000,
    deliveryCents: 6_000,
    totalCents: 106_000,
  };

  return new CheckoutService(
    {} as never,
    { priceCart: vi.fn().mockResolvedValue(priced) } as never,
    { decrement: vi.fn().mockResolvedValue(undefined) } as never,
    { redeem: vi.fn() } as never,
    { require: vi.fn().mockResolvedValue(undefined) } as never,
    inviteService,
    new WaitlistFulfillmentService({} as never),
  );
}

describe("checkout with an invite token", () => {
  it("stamps the order onto the waitlist entry and flips it to CONVERTED", async () => {
    const { tx, updates } = fakeTx([
      { entryId: ENTRY_ID, bookId: "book-1", quantity: 2, mode: "LOCKED" },
    ]);
    const service = checkoutService(new WaitlistInviteService({} as never));

    // writeOrder is private because a caller must not run it outside a
    // transaction; the conversion write is the thing under test, so it is
    // reached directly rather than through a second layer of db mocks.
    await (service as never as { writeOrder: (...args: unknown[]) => Promise<string> }).writeOrder(
      request(),
      "idem-1",
      tx,
    );

    const conversion = updates.find(
      (statement) => statement.table === waitlistEntries && "convertedOrderId" in statement.values,
    );

    expect(conversion).toBeDefined();
    expect(conversion?.values.convertedOrderId).toBe(ORDER_ID);
    expect(conversion?.values.status).toBe("CONVERTED");
  });

  it("spends the token before linking the order, on the same handle", async () => {
    // Order matters and is not cosmetic: the token is spent before anything is
    // priced so a dead invite touches no stock, and the link is written after
    // the insert because until then there is no order id to write. Both on
    // `tx`, so a later failure rolls back the spend *and* the conversion.
    const { tx, updates } = fakeTx([
      { entryId: ENTRY_ID, bookId: "book-1", quantity: 2, mode: "OPEN" },
    ]);
    const service = checkoutService(new WaitlistInviteService({} as never));

    await (service as never as { writeOrder: (...args: unknown[]) => Promise<string> }).writeOrder(
      request(),
      "idem-2",
      tx,
    );

    const entryWrites = updates.filter((statement) => statement.table === waitlistEntries);

    expect(entryWrites).toHaveLength(3);
    expect(entryWrites[0].values).toHaveProperty("inviteUsedAt");
    expect(entryWrites[1].values.convertedOrderId).toBe(ORDER_ID);

    /* The third is the sweep for entries this same customer has on *other*
       books in the basket, which an invite checkout can settle just as easily
       as a walk-in can — the token names one entry, not one customer. It runs
       last so the ids already converted above can be excluded by name rather
       than left to the status filter, which would depend on which of two
       statements in one transaction Postgres applied first. */
    expect(entryWrites[2].values.fulfillingOrderId).toBe(ORDER_ID);
  });

  it("looks the customer up by phone when the checkout carries no token", async () => {
    /* What a walk-in used to get: nothing at all. The waitlist was reachable
       only through a token, so somebody who joined the queue and then bought
       the book the ordinary way stayed in it — still being texted, still
       holding copies. Two statements now go out for them instead: spend any
       live hold of their own, and link the order to whatever they are still
       waiting for. */
    const { tx, updates } = fakeTx([]);
    const service = checkoutService(new WaitlistInviteService({} as never));
    const walkIn = { ...request(), inviteToken: undefined };

    await (service as never as { writeOrder: (...args: unknown[]) => Promise<string> }).writeOrder(
      walkIn,
      "idem-3",
      tx,
    );

    const entryWrites = updates.filter((statement) => statement.table === waitlistEntries);

    expect(entryWrites).toHaveLength(2);
    // Their own reservation, spent without the link — before pricing, so the
    // copies it frees are copies this basket can be priced against.
    expect(entryWrites[0].values).toHaveProperty("inviteUsedAt");
    // And the link to the order, which is emphatically *not* a conversion:
    // nobody has paid yet.
    expect(entryWrites[1].values.fulfillingOrderId).toBe(ORDER_ID);
    expect(entryWrites[1].values).not.toHaveProperty("status");
  });
});

describe("a LOCKED invite's quantity is a ceiling", () => {
  /* Three copies reserved. Fewer is the customer changing their mind, which
     the shop would rather have than the order placed outside the invite;
     more is the reservation being overrun, which is the whole point of
     LOCKED. The floor is one, and the cart schema refuses zero before this
     code runs. */
  const reserved = (quantity: number) => [
    { entryId: ENTRY_ID, bookId: "book-1", quantity, mode: "LOCKED" as const },
  ];

  const place = (items: { bookId: string; quantity: number }[], reservation: number) => {
    const { tx, updates } = fakeTx(reserved(reservation));
    const service = checkoutService(new WaitlistInviteService({} as never));

    return {
      updates,
      run: () =>
        (service as never as { writeOrder: (...args: unknown[]) => Promise<string> }).writeOrder(
          request(items),
          "idem-ceiling",
          tx,
        ),
    };
  };

  it.each([1, 2, 3])("accepts %i of the 3 copies reserved", async (quantity) => {
    const { run, updates } = place([{ bookId: "book-1", quantity }], 3);

    await expect(run()).resolves.toBeDefined();
    expect(updates.find((statement) => "convertedOrderId" in statement.values)).toBeDefined();
  });

  it("refuses more copies than were reserved", async () => {
    const { run } = place([{ bookId: "book-1", quantity: 4 }], 3);

    await expect(run()).rejects.toBeInstanceOf(WaitlistInviteMismatchError);
  });

  it("refuses a basket that leaves the reserved book out", async () => {
    /* The token would otherwise be spent on an order for something else: the
       entry would close as CONVERTED against a book it never reserved, and the
       copies it held would go to nobody. Those other titles need no invite. */
    const { run } = place([{ bookId: "book-2", quantity: 1 }], 3);

    await expect(run()).rejects.toBeInstanceOf(WaitlistInviteMismatchError);
  });

  it("lets the invited book travel with other titles in one order", async () => {
    /* What LOCKED constrains is the reserved book, not the basket around it.
       Refusing the second line here sent the customer away with two orders and
       two delivery fees — and they could not place the *first* one without the
       invite, since their own reservation makes the book read as sold out. */
    const { run, updates } = place(
      [
        { bookId: "book-1", quantity: 1 },
        { bookId: "book-2", quantity: 1 },
      ],
      3,
    );

    await expect(run()).resolves.toBeDefined();
    expect(updates.find((statement) => "convertedOrderId" in statement.values)).toBeDefined();
  });

  it("sums the reserved book across lines rather than reading the first", async () => {
    /* A cart may name one book twice — pricing merges duplicates — so a
       ceiling checked against a single line would let 2 + 2 past a hold of 3. */
    const { run } = place(
      [
        { bookId: "book-1", quantity: 2 },
        { bookId: "book-1", quantity: 2 },
      ],
      3,
    );

    await expect(run()).rejects.toBeInstanceOf(WaitlistInviteMismatchError);
  });
});

describe("WaitlistInviteService.markConverted", () => {
  it("writes the order id and the status in one statement", async () => {
    const { tx, updates } = fakeTx([]);

    await new WaitlistInviteService({} as never).markConverted(ENTRY_ID, ORDER_ID, tx);

    expect(updates).toHaveLength(1);
    expect(updates[0].values).toMatchObject({
      status: "CONVERTED",
      convertedOrderId: ORDER_ID,
    });
  });
});
