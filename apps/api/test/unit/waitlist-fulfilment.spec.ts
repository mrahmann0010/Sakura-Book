import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  releasesWaitlist,
  settlesWaitlist,
  type OrderStatus,
} from "../../src/orders/order-status.machine";
import { WaitlistFulfillmentService } from "../../src/waitlist/waitlist-fulfillment.service";
import { WaitlistInviteService } from "../../src/waitlist/waitlist-invite.service";
import { waitlistLaneSql } from "../../src/waitlist/waitlist-lane";

/**
 * Buying the book settles the queue entry that asked for it.
 *
 * The bug underneath this file was one of omission and was invisible from
 * every screen: checkout only ever consulted the waitlist when the request
 * carried an invite token, so a customer who joined a book's queue and then
 * bought that book the ordinary way stayed in the queue as if they were still
 * waiting. They kept getting restock texts for a book on their shelf, their
 * live invite kept copies off the public shelf until it lapsed, and — in the
 * sharpest reading — the copies being held *for them* were the copies the
 * storefront refused to sell them, because availability subtracts every
 * reservation without asking whose it is.
 *
 * These are statement tests. Each method here is one guarded UPDATE whose
 * WHERE clause *is* the policy — who counts as the same person, which entries
 * are off limits, what a settlement may not touch — so the assertions read the
 * rendered SQL rather than a stubbed return value. A test that only checked
 * the values being written would pass just as happily while the statement
 * matched every row in the table.
 */

type Statement = { values: Record<string, unknown>; where: SQL };

/** A `tx` that records the UPDATEs issued against it instead of running them. */
function fakeTx(returned: unknown[] = []) {
  const statements: Statement[] = [];

  const tx = {
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: (where: SQL) => {
          statements.push({ values, where });

          return {
            returning: () => Promise.resolve(returned),
            then: (resolve: (value: unknown) => unknown) => Promise.resolve(returned).then(resolve),
          };
        },
      }),
    }),
  };

  return { tx: tx as never, statements };
}

/** The WHERE clause as Postgres would receive it, for reading policy off. */
function render(where: SQL): { sql: string; params: unknown[] } {
  const query = new PgDialect().sqlToQuery(where);

  return { sql: query.sql, params: query.params };
}

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const BOOK_ID = "22222222-2222-4222-8222-222222222222";

function fulfillment() {
  return new WaitlistFulfillmentService({} as never);
}

describe("linking an order to the entries it settles", () => {
  it("matches on the E.164 form of the phone, not on what was typed", async () => {
    /* Checkout stores the number as the customer typed it and the waitlist
       stores E.164, so a literal comparison matches almost nothing — and does
       so silently, which is the failure mode this whole feature is trying to
       stop being possible. `01711-111111` and `+8801711111111` are the same
       person to the SMS gateway and have to be the same person here. */
    const { tx, statements } = fakeTx();

    await fulfillment().markOrdered("01711-111111", [BOOK_ID], ORDER_ID, tx);

    expect(render(statements[0]!.where).params).toContain("+8801711111111");
  });

  it("requires the book as well as the phone", async () => {
    /* Phone alone would close a queue for a title the customer did not buy —
       the shop would stop telling somebody about the book they are waiting for
       because they bought a different one, which is worse than the bug being
       fixed. */
    const { tx, statements } = fakeTx();

    await fulfillment().markOrdered("+8801711111111", [BOOK_ID], ORDER_ID, tx);

    const { sql, params } = render(statements[0]!.where);

    expect(sql).toContain('"customer_phone"');
    expect(sql).toContain('"book_id"');
    expect(params).toContain(BOOK_ID);
  });

  it("leaves converted and cancelled entries alone", async () => {
    /* CONVERTED is finished. CANCELLED is the shop's only do-not-contact
       record, and a purchase is not a request to be put back on a list
       somebody asked to leave. */
    const { tx, statements } = fakeTx();

    await fulfillment().markOrdered("+8801711111111", [BOOK_ID], ORDER_ID, tx);

    const { params } = render(statements[0]!.where);

    expect(params).toContain("CONVERTED");
    expect(params).toContain("CANCELLED");
  });

  it("excludes the entries this same checkout already converted", async () => {
    /* Both writes are in flight in one transaction, so this cannot be left to
       the status filter above: whether the exclusion works would depend on
       which statement Postgres happened to apply first. */
    const { tx, statements } = fakeTx();

    await fulfillment().markOrdered("+8801711111111", [BOOK_ID], ORDER_ID, tx, {
      excludeEntryIds: ["entry-just-converted"],
    });

    expect(render(statements[0]!.where).params).toContain("entry-just-converted");
  });

  it("writes the order link and no status at all", async () => {
    /* The entry stays PENDING or NOTIFIED — the record of what the shop has
       actually done with this person — and the ORDERED lane is computed from
       the link alone. That is precisely what lets `release` be a single
       null-out instead of a guess at which status to put back. */
    const { tx, statements } = fakeTx();

    await fulfillment().markOrdered("+8801711111111", [BOOK_ID], ORDER_ID, tx);

    expect(statements[0]!.values.fulfillingOrderId).toBe(ORDER_ID);
    expect(statements[0]!.values).not.toHaveProperty("status");
  });

  it("issues no statement at all for an order with no books", async () => {
    const { tx, statements } = fakeTx();

    await expect(fulfillment().markOrdered("+8801711111111", [], ORDER_ID, tx)).resolves.toEqual(
      [],
    );
    expect(statements).toHaveLength(0);
  });
});

describe("the order is paid for", () => {
  it("converts the entries it was standing in for and drops the pending link", async () => {
    /* Both in one statement: the belief has been replaced by the fact, and
       leaving both columns set would give the row two answers to "which order
       was this" for some later query to pick between. */
    const { tx, statements } = fakeTx([{ id: "entry-1" }]);

    await fulfillment().settle(ORDER_ID, tx);

    expect(statements[0]!.values).toMatchObject({
      status: "CONVERTED",
      convertedOrderId: ORDER_ID,
      fulfillingOrderId: null,
    });
  });

  it("does not convert an entry the customer cancelled meanwhile", async () => {
    /* Asking to come off the list mid-order is still asking to come off the
       list. The link is dropped all the same, by the second statement, so the
       panel stops reporting a pending order for a row nobody is working. */
    const { tx, statements } = fakeTx([]);

    await fulfillment().settle(ORDER_ID, tx);

    expect(render(statements[0]!.where).params).toContain("CANCELLED");
    expect(statements[1]!.values).toEqual({
      fulfillingOrderId: null,
      updatedAt: expect.anything(),
    });
  });
});

describe("the order dies", () => {
  it("puts the entry back in the queue without touching its place in it", async () => {
    /* `created_at` is the fairness key the whole queue is ordered by and
       `invite_attempts` is the record of turns already had. An abandoned
       cash-on-delivery parcel is the most ordinary event on this desk, and it
       must not cost somebody the seat they signed up for. */
    const { tx, statements } = fakeTx([{ id: "entry-1" }]);

    await fulfillment().release(ORDER_ID, tx);

    expect(statements[0]!.values.fulfillingOrderId).toBeNull();
    expect(statements[0]!.values).not.toHaveProperty("status");
    expect(statements[0]!.values).not.toHaveProperty("createdAt");
    expect(statements[0]!.values).not.toHaveProperty("inviteAttempts");
  });

  it("leaves an already-converted entry converted", async () => {
    /* Settling cleared the column this matches on, so a refund after delivery
       cannot walk a recorded sale backwards. The queue did its job; the sale
       came apart afterwards, which is not a fact about the queue. */
    const { tx, statements } = fakeTx([]);

    await fulfillment().release(ORDER_ID, tx);

    expect(render(statements[0]!.where).sql).toContain('"fulfilling_order_id"');
    expect(statements[0]!.values).not.toHaveProperty("status");
  });
});

describe("which status changes mean what for the queue", () => {
  it("settles on payment, for both of the shop's payment methods", () => {
    /* PAYMENT_CONFIRMED is the earliest honest answer for both: a transfer
       matched at the desk, and a cash-on-delivery order, which can only reach
       this status by being marked delivered. Waiting for DELIVERED would leave
       prepaid customers suppressed for days after the shop had the money. */
    expect(settlesWaitlist("PAYMENT_CONFIRMED")).toBe(true);

    for (const status of ["PENDING", "PROCESSING", "SHIPPED", "DELIVERED"] as OrderStatus[]) {
      expect(settlesWaitlist(status)).toBe(false);
    }
  });

  it("releases on every terminal status and no other", () => {
    expect(releasesWaitlist("CANCELLED")).toBe(true);
    expect(releasesWaitlist("REFUNDED")).toBe(true);

    for (const status of ["PENDING", "PAYMENT_CONFIRMED", "SHIPPED"] as OrderStatus[]) {
      expect(releasesWaitlist(status)).toBe(false);
    }
  });

  it("never both settles and releases", () => {
    /* `OrdersService.transition` picks between them with an else, so an
        overlap would silently make one of the two unreachable. */
    const statuses: OrderStatus[] = [
      "PENDING",
      "PAYMENT_CONFIRMED",
      "PROCESSING",
      "SHIPPED",
      "DELIVERED",
      "CANCELLED",
      "REFUNDED",
    ];

    for (const status of statuses) {
      expect(settlesWaitlist(status) && releasesWaitlist(status)).toBe(false);
    }
  });
});

describe("the ORDERED lane", () => {
  const lane = () => new PgDialect().sqlToQuery(waitlistLaneSql()).sql;

  it("yields to a live invite, and wins over a lapsed one", () => {
    /* The order of the CASE arms is the whole policy. A live link means the
       storefront is holding copies under the one condition
       `inventory/reservations.ts` holds them back under, and a row matching it
       has to read INVITED or the panel and the shelf describe the same copy
       differently. A lapsed link holds nothing, so the order speaks instead —
       and must, because letting EXPIRED win would feed somebody with a parcel
       already on the way back into the next wave's candidate pool. */
    const sql = lane();

    expect(sql.indexOf("'INVITED'")).toBeLessThan(sql.indexOf("'ORDERED'"));
    expect(sql.indexOf("'ORDERED'")).toBeLessThan(sql.indexOf("'EXPIRED'"));
  });

  it("stays behind both terminal lanes", () => {
    const sql = lane();

    expect(sql.indexOf("'CANCELLED'")).toBeLessThan(sql.indexOf("'ORDERED'"));
    expect(sql.indexOf("'CONVERTED'")).toBeLessThan(sql.indexOf("'ORDERED'"));
  });
});

describe("spending a hold the customer never clicked", () => {
  it("matches their own live invites for the books in the basket", async () => {
    /* The link is a convenience for reaching a pre-filled checkout page, not
       the thing that entitles them to the copy — their entry is. Same three
       conditions `consume` matches on; only the way the row is found differs. */
    const { tx, statements } = fakeTx([]);

    await new WaitlistInviteService({} as never).consumeForCustomer("01711-111111", [BOOK_ID], tx);

    const { sql, params } = render(statements[0]!.where);

    expect(params).toContain("+8801711111111");
    expect(params).toContain(BOOK_ID);
    expect(sql).toContain('"invite_token" is not null');
    expect(sql).toContain('"invite_used_at" is null');
    expect(sql).toContain('"invite_expires_at" >');
    expect(statements[0]!.values).toHaveProperty("inviteUsedAt");
  });

  it("touches nothing when the basket names no books", async () => {
    const { tx, statements } = fakeTx();

    await expect(
      new WaitlistInviteService({} as never).consumeForCustomer("+8801711111111", [], tx),
    ).resolves.toEqual([]);
    expect(statements).toHaveLength(0);
  });
});

/* The checkout wiring itself — which of these runs when, and in what order
   relative to pricing — is pinned in waitlist-conversion.spec.ts, which drives
   `writeOrder` end to end. */
