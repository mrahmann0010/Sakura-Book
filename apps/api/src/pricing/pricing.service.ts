import { Injectable } from "@nestjs/common";
import { MAX_LINE_QUANTITY, type CartItem, type CartQuoteRejection } from "@sakura/contracts";
import { BooksService, type PriceableBook } from "../catalog";
import { CouponsService } from "../coupons";
import { DbService } from "../db/db.service";
import type { Executor } from "../db/db.types";
import type { PricedCart, PricedLine } from "./priced-cart";
import { ShippingPolicy } from "./shipping.policy";

/**
 * The pricing authority.
 *
 * Every figure a customer is shown or charged is computed here, from the
 * database and from ShippingPolicy — never from anything the client sent
 * beyond the list of `{ bookId, quantity }` pairs. The request body has no
 * price field and no total field, and that is not an oversight: a cart is
 * client state, a cart's *price* is not (§3.8).
 *
 * `priceCart` is written to be called twice per order — once by `/cart/quote`
 * to render the summary rail, once by checkout inside its transaction to
 * decide what to charge — because a quote handed back by the client is just a
 * total the client sent, with extra steps.
 */
@Injectable()
export class PricingService {
  constructor(
    private readonly dbService: DbService,
    private readonly booksService: BooksService,
    private readonly couponsService: CouponsService,
    private readonly shippingPolicy: ShippingPolicy,
  ) {}

  /**
   * Price a set of cart items.
   *
   * Never throws for an unorderable line. A cart that has gone stale in
   * localStorage is the normal case, not an error: the cart page has to render
   * *and* explain why the total moved, so dropped lines come back in
   * `rejected` with a reason. Checkout applies its own, stricter reading of
   * the same result — see CheckoutService.
   *
   * `region` is accepted and currently unused. The regions table and its
   * per-region overrides are Phase 1; the parameter exists now so that adding
   * them is a change inside ShippingPolicy rather than a change to the request
   * schema every client has already shipped.
   */
  async priceCart(
    items: CartItem[],
    options: { couponCode?: string; region?: string } = {},
    executor: Executor = this.dbService.db,
  ): Promise<PricedCart> {
    const merged = mergeItems(items);
    const books = await this.booksService.priceable([...merged.keys()], executor);

    const lines: PricedLine[] = [];
    const rejected: CartQuoteRejection[] = [];

    for (const [bookId, quantity] of merged) {
      const book = books.get(bookId);
      const rejection = rejectionFor(bookId, book);

      if (rejection) {
        rejected.push(rejection);
        continue;
      }

      lines.push(toLine(book as PriceableBook, quantity));
    }

    const subtotalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
    const coupon = await this.applyCoupon(options.couponCode, subtotalCents, executor);
    const discountCents = coupon.applied?.discountCents ?? 0;

    /* The free-delivery threshold is tested against the subtotal *after* the
       discount — what the customer is actually paying for the goods. The other
       reading (test before the discount) would let a coupon buy free postage
       as a side effect, which is not a thing any of these coupons advertise;
       "free shipping" is explicitly not expressible in this coupon model, see
       CouponsService.computeDiscountCents. If that is ever the wrong call it is
       one argument on the next line, not a rewrite. */
    const delivery = this.shippingPolicy.quote(subtotalCents - discountCents, lines.length);
    const terms = this.shippingPolicy.terms;

    return {
      currency: terms.currency,
      lines,
      rejected,

      subtotalCents,
      deliveryBaseCents: delivery.baseCents,
      deliveryCents: delivery.chargedCents,
      deliveryCreditCents: delivery.creditCents,

      coupon: coupon.applied,
      couponRejection: coupon.rejection,

      // Clamped rather than trusted to be non-negative. computeDiscountCents
      // already caps the discount at the subtotal, so this can only fire if
      // that guarantee is ever weakened — and a negative total is the one
      // arithmetic outcome that must never reach a payment provider.
      totalCents: Math.max(0, subtotalCents - discountCents + delivery.chargedCents),

      freeDeliveryThresholdCents: terms.freeDeliveryThresholdCents,
    };
  }

  /**
   * A refused code is a returned reason, not a throw — the cart renders it
   * beside the input, exactly as /coupons/validate does. Checkout is the caller
   * that turns a refusal into an error, because there the customer has already
   * been quoted a discount and silently charging them full price would be the
   * worse failure.
   */
  private async applyCoupon(
    couponCode: string | undefined,
    subtotalCents: number,
    executor: Executor,
  ): Promise<{
    applied?: { id: string; code: string; discountCents: number };
    rejection?: string;
  }> {
    if (!couponCode) return {};

    const evaluation = await this.couponsService.evaluate(couponCode, subtotalCents, executor);
    if (!evaluation.ok) return { rejection: evaluation.reason };

    return {
      applied: {
        id: evaluation.coupon.id,
        code: evaluation.coupon.code,
        discountCents: evaluation.discountCents,
      },
    };
  }
}

/**
 * Collapse repeated ids into one line, capped.
 *
 * The schema caps each *item* at MAX_LINE_QUANTITY, but nothing stops a client
 * sending the same bookId across fifty entries — which would pass validation
 * and price a cart of 4,950 copies. Merging first makes the cap mean what it
 * reads as, and incidentally makes the response stable: one line per title,
 * whatever the client's array looked like.
 */
function mergeItems(items: CartItem[]): Map<string, number> {
  const merged = new Map<string, number>();

  for (const item of items) {
    const total = (merged.get(item.bookId) ?? 0) + item.quantity;
    merged.set(item.bookId, Math.min(total, MAX_LINE_QUANTITY));
  }

  return merged;
}

/** Why this line cannot be priced, or undefined if it can. */
function rejectionFor(
  bookId: string,
  book: PriceableBook | undefined,
): CartQuoteRejection | undefined {
  if (!book) return { bookId, reason: "NOT_FOUND" };
  if (!book.isActive) return { bookId, reason: "UNAVAILABLE" };

  // Only a *zero* stock rejects the line. A line short of the requested
  // quantity is still priced at what was asked for, with `stockQuantity`
  // alongside it: the cart clamps its stepper and flags the row, which is a
  // better recovery than the server silently reducing an order. What the
  // customer actually gets is decided by the guarded decrement at checkout,
  // and nothing before that point is a promise.
  if (book.stockQuantity <= 0) return { bookId, reason: "OUT_OF_STOCK", available: 0 };

  return undefined;
}

function toLine(book: PriceableBook, quantity: number): PricedLine {
  return {
    bookId: book.id,
    slug: book.slug,
    title: book.title,
    authors: book.authors,
    coverImageUrl: book.coverImageUrl,
    quantity,
    unitPriceCents: book.priceCents,
    // Integer cents times an integer quantity — exact, and the reason money
    // never becomes a float anywhere in this codebase (§3.7).
    lineTotalCents: book.priceCents * quantity,
    stockQuantity: book.stockQuantity,
  };
}
