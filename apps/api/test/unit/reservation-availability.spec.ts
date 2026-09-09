import { describe, expect, it } from "vitest";
import type { PriceableBook } from "../../src/catalog";
import { PricingService } from "../../src/pricing/pricing.service";

/**
 * Who a copy on the shelf actually belongs to.
 *
 * The shop sells a print run smaller than the queue waiting for it, so "sixty
 * copies in stock" and "sixty copies a stranger may buy" stopped being the same
 * sentence. Availability is now the difference between the two, and these tests
 * pin the two halves of that:
 *
 *   - a shopper with no invite is refused a title whose copies are all
 *     promised, even though the shelf is full;
 *   - the person those copies are being held for is not refused their own
 *     reservation.
 *
 * The second half is the one worth guarding hardest. It is easy to write a
 * reservation check that protects the queue so well it locks out the queue,
 * and the failure is silent: the invited customer simply sees "sold out" and
 * assumes they were too late.
 *
 * The guarded UPDATE at checkout enforces the same rule against concurrent
 * buyers and cannot be covered here — it is a WHERE clause, and only a real
 * Postgres can say whether it holds.
 */

function book(overrides: Partial<PriceableBook> = {}): PriceableBook {
  return {
    id: "book-a",
    slug: "a-title",
    title: "A Title",
    authors: ["Someone"],
    coverImageUrl: "https://cdn.example/a.png",
    priceCents: 30_000,
    stockQuantity: 60,
    reservedQuantity: 0,
    isActive: true,
    availability: "in_stock",
    publishedDate: null,
    ...overrides,
  };
}

function service(row: PriceableBook) {
  return new PricingService(
    { db: {} } as never,
    { priceable: async () => new Map([[row.id, row]]) } as never,
    { evaluate: async () => ({ ok: false, reason: "UNKNOWN" }) } as never,
    { quote: () => ({ baseCents: 0, chargedCents: 0, creditCents: 0 }) } as never,
    { current: async () => ({ currency: "BDT" }) } as never,
    { deliveryRateFor: async () => 0 } as never,
  );
}

const oneCopy = [{ bookId: "book-a", quantity: 1 }];

describe("cart availability — stock less what is already promised", () => {
  it("refuses a stranger a title whose every copy is spoken for", async () => {
    // Sixty on the shelf, sixty owed. The old check read `stockQuantity <= 0`
    // and waved this through, which is how someone browsing the catalog could
    // take a copy from a person who had been waiting weeks for it.
    const priced = await service(book({ stockQuantity: 60, reservedQuantity: 60 })).priceCart(
      oneCopy,
    );

    expect(priced.lines).toHaveLength(0);
    expect(priced.rejected[0]).toMatchObject({ bookId: "book-a", reason: "OUT_OF_STOCK" });
  });

  it("sells the copies that are not promised", async () => {
    const priced = await service(book({ stockQuantity: 60, reservedQuantity: 59 })).priceCart(
      oneCopy,
    );

    expect(priced.rejected).toHaveLength(0);
    expect(priced.lines[0]).toMatchObject({ bookId: "book-a", quantity: 1 });
  });

  it("does not refuse invite holders their own reservation", async () => {
    // Their copies are still counted as reserved — the token is unspent right
    // up until checkout — so without discounting what is being held *for them*
    // the invite would be refused by the very reservation it created.
    const priced = await service(book({ stockQuantity: 60, reservedQuantity: 60 })).priceCart(
      oneCopy,
      { holding: { bookId: "book-a", quantity: 1 } },
    );

    expect(priced.rejected).toHaveLength(0);
    expect(priced.lines[0]).toMatchObject({ bookId: "book-a", quantity: 1 });
  });

  it("hands a holder only their own copies, not the rest of the queue's", async () => {
    // Holding one does not unlock a second: the other fifty-nine belong to
    // fifty-nine other people.
    //
    // A quote does not refuse an over-large line — that is longstanding and
    // deliberate, so the cart can show the row and clamp it rather than have
    // the server silently reduce the order. What it must not do is *offer* the
    // second copy, so the maximum is the assertion here. Checkout's guarded
    // decrement is what actually refuses, and it reads the same arithmetic.
    const priced = await service(book({ stockQuantity: 60, reservedQuantity: 60 })).priceCart(
      [{ bookId: "book-a", quantity: 2 }],
      { holding: { bookId: "book-a", quantity: 1 } },
    );

    expect(priced.lines[0]!.stockQuantity).toBe(1);
  });

  it("caps the stepper at what is unreserved, not at the shelf count", async () => {
    // The bug this pins: 60 on the shelf, 58 promised, and a cart that used to
    // offer all 60 to someone entitled to 2.
    const priced = await service(book({ stockQuantity: 60, reservedQuantity: 58 })).priceCart(
      oneCopy,
    );

    expect(priced.lines[0]!.stockQuantity).toBe(2);
  });

  it("does not let an invite for one book unlock a different one", async () => {
    const priced = await service(book({ stockQuantity: 60, reservedQuantity: 60 })).priceCart(
      oneCopy,
      { holding: { bookId: "some-other-book", quantity: 1 } },
    );

    expect(priced.rejected[0]).toMatchObject({ reason: "OUT_OF_STOCK" });
  });

  it("still refuses an over-issued title rather than reading its negative allowance as room", async () => {
    // More promised than printed — an admin lowering the count can create this
    // at any time. Nobody may buy; the fix is an admin's, not a shopper's.
    const priced = await service(book({ stockQuantity: 60, reservedQuantity: 62 })).priceCart(
      oneCopy,
    );

    expect(priced.rejected[0]).toMatchObject({ reason: "OUT_OF_STOCK", available: 0 });
  });

  it("still refuses a delisted title, reservations or not", async () => {
    const priced = await service(book({ isActive: false, reservedQuantity: 0 })).priceCart(oneCopy);

    expect(priced.rejected[0]).toMatchObject({ reason: "UNAVAILABLE" });
  });
});
