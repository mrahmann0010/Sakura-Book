import { Injectable, Logger } from "@nestjs/common";
import type { Order, PlaceOrderRequest } from "@sakura/contracts";
import { eq, type SQL } from "drizzle-orm";
import { isPostgresError } from "../common/errors";
import { CouponsService } from "../coupons";
import { DbService } from "../db/db.service";
import type { Transaction } from "../db/db.types";
import { orderItems, orders, orderStatusHistory } from "../db/schema";
import { InventoryService } from "../inventory";
import { PricingService, type PricedCart } from "../pricing";
import { RegionsService } from "../shipping";
import { generateOrderNumber, ORDER_NUMBER_ATTEMPTS } from "./order-number";
import {
  CartNotOrderableError,
  CouponNotApplicableError,
  OrderNumberExhaustedError,
} from "./order.errors";
import { toOrderResponse, type OrderRow } from "./order.mapper";
import { findOrder } from "./order.query";

/**
 * Placing an order. The one write path a customer can reach.
 *
 * This is the use-case service of §3.3: it owns the transaction and passes the
 * handle down to every collaborator, none of which opens one itself. What has
 * to be atomic is the whole set — stock decremented, coupon use consumed,
 * order and its lines and its first status event written — because any subset
 * committing on its own is either inventory we cannot sell or a discount
 * granted for an order that does not exist.
 *
 * The client sends items, a customer, and optionally a coupon code. It does not
 * send a total, and if it did, nothing here would read it.
 */
@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly pricingService: PricingService,
    private readonly inventoryService: InventoryService,
    private readonly couponsService: CouponsService,
    private readonly regionsService: RegionsService,
  ) {}

  /**
   * @returns the order, and whether this call is the one that created it.
   *
   * The flag is how the controller picks 201 vs 200 for a replay. It is
   * returned rather than signalled by throwing, because a replay is a success:
   * the customer's intent ("place this order once") has been satisfied, and
   * the only correct response is the order itself.
   */
  async placeOrder(
    request: PlaceOrderRequest,
    idempotencyKey: string,
  ): Promise<{ order: Order; created: boolean }> {
    /* Cheap path first: a retry after a completed request, a double-submit
       from a second tab, a customer hitting back and pressing the button
       again. None of those should open a transaction or touch stock. This is
       an optimisation and not the guarantee — the guarantee is the unique
       index, caught below. */
    const existing = await this.findByIdempotencyKey(idempotencyKey);
    if (existing) return { order: toOrderResponse(existing), created: false };

    try {
      const orderId = await this.dbService.db.transaction((tx) =>
        this.writeOrder(request, idempotencyKey, tx),
      );

      const created = await this.findById(orderId);
      // Unreachable: the transaction above committed this row. Guarded rather
      // than asserted so a future change that makes it reachable fails loudly.
      if (!created) throw new Error(`Order ${orderId} vanished after commit`);

      return { order: toOrderResponse(created), created: true };
    } catch (error) {
      const replayed = await this.replayOf(error, idempotencyKey);
      if (replayed) return { order: toOrderResponse(replayed), created: false };
      throw error;
    }
  }

  /**
   * Everything that must commit together.
   *
   * The order of operations is not arbitrary. Pricing runs first and inside
   * the transaction, so the prices charged are the ones the stock decrement is
   * about to be taken against. Stock moves before the order row is written,
   * because a decrement that fails must abort before anything customer-facing
   * exists. Coupon redemption is last of the guarded writes for the same
   * reason: it is the one with a hard usage cap.
   */
  private async writeOrder(
    request: PlaceOrderRequest,
    idempotencyKey: string,
    tx: Transaction,
  ): Promise<string> {
    const priced = await this.repriceForOrder(request, tx);

    // Sequential, not Promise.all. These are guarded UPDATEs against rows two
    // concurrent checkouts may share, and issuing them in parallel on one
    // connection buys nothing (postgres-js pipelines a single transaction's
    // statements anyway) while making lock acquisition order depend on
    // scheduling — which is how deadlocks between two carts holding the same
    // two titles in different orders start.
    for (const line of priced.lines) {
      await this.inventoryService.decrement(line.bookId, line.quantity, tx);
    }

    if (priced.coupon) {
      // Re-checks the usage limit atomically and throws COUPON_UNAVAILABLE if
      // the code ran out since pricing. That throw rolls back the decrements
      // above, which is the entire reason this is one transaction.
      await this.couponsService.redeem(priced.coupon.id, tx);
    }

    const orderId = await this.insertOrder(request, priced, idempotencyKey, tx);

    await tx.insert(orderItems).values(
      priced.lines.map((line) => ({
        orderId,
        bookId: line.bookId,
        bookTitleSnapshot: line.title,
        authorNamesSnapshot: line.authors,
        unitPriceCents: line.unitPriceCents,
        quantity: line.quantity,
      })),
    );

    // The first entry in the append-only log. Written here rather than by a
    // trigger or a default, so that the history is complete from the order's
    // first moment — a timeline that starts at the *second* status is a
    // timeline with a hole no later query can fill.
    await tx.insert(orderStatusHistory).values({ orderId, status: "PENDING" });

    return orderId;
  }

  /**
   * Re-price from scratch, and refuse anything the cart page would merely have
   * reported.
   *
   * Same PricingService call `/cart/quote` makes — deliberately, so there is
   * one implementation of the delivery ladder and the discount rules rather
   * than a checkout copy that drifts. What differs is the reading of the
   * result: a quote reports dropped lines so the cart can explain itself, and
   * an order refuses them, because by this point the customer has approved a
   * specific basket for a specific total.
   */
  private async repriceForOrder(request: PlaceOrderRequest, tx: Transaction): Promise<PricedCart> {
    /* Strict region check, and it has to happen before pricing rather than
       alongside it. PricingService treats an unrecognised region as "not
       chosen yet" and quotes the flat rate, which is right for a cart page
       that renders before the address step — but here the region is a field
       the customer filled in, and quoting flat-rate postage to somewhere we do
       not deliver would write an undeliverable order at a price we invented.
       The throw rolls the transaction back like any other refusal. */
    await this.regionsService.require(request.customer.region, tx);

    const priced = await this.pricingService.priceCart(
      request.items,
      { couponCode: request.couponCode, region: request.customer.region },
      tx,
    );

    if (priced.rejected.length > 0) throw new CartNotOrderableError(priced.rejected);

    // A sent code that did not apply. `couponRejection` is only ever set when
    // a code was sent, so this cannot fire for a cart without one.
    if (priced.couponRejection) {
      throw new CouponNotApplicableError(request.couponCode ?? "", priced.couponRejection);
    }

    // Belt and braces: an empty priced cart with no rejections would mean the
    // request passed schema validation with zero items, which `min(1)` forbids.
    if (priced.lines.length === 0) throw new CartNotOrderableError([]);

    return priced;
  }

  /**
   * Insert the order, re-rolling the order number on collision.
   *
   * The retry is scoped to a savepoint (`tx.transaction`) rather than being a
   * plain loop, and that is load-bearing: in Postgres, a constraint violation
   * aborts the *whole* transaction, so a second INSERT on the same handle
   * fails with "current transaction is aborted" no matter how good the new
   * number is. The nested call rolls back only the failed statement.
   */
  private async insertOrder(
    request: PlaceOrderRequest,
    priced: PricedCart,
    idempotencyKey: string,
    tx: Transaction,
  ): Promise<string> {
    const { customer } = request;

    const values = {
      customerName: customer.fullName,
      customerEmail: customer.email,
      customerPhone: customer.phone,
      shippingAddress: {
        address: customer.address,
        city: customer.city,
        region: customer.region,
      },

      subtotalCents: priced.subtotalCents,
      shippingCents: priced.deliveryCents,

      couponId: priced.coupon?.id ?? null,
      discountCodeSnapshot: priced.coupon?.code ?? null,
      discountCents: priced.coupon?.discountCents ?? 0,

      totalCents: priced.totalCents,

      customerNote: customer.notes ?? null,
      idempotencyKey,
      paymentMethod: customer.method,
    };

    for (let attempt = 1; attempt <= ORDER_NUMBER_ATTEMPTS; attempt++) {
      try {
        const [inserted] = await tx.transaction((savepoint) =>
          savepoint
            .insert(orders)
            .values({ ...values, orderNumber: generateOrderNumber() })
            .returning({ id: orders.id }),
        );

        return inserted.id;
      } catch (error) {
        // Only an order-number collision is retryable here. An idempotency-key
        // collision means a concurrent request already placed this order, and
        // re-rolling the number would place it a second time — so it is
        // rethrown for placeOrder's replay handler.
        if (!isUniqueViolationOn(error, ORDER_NUMBER_CONSTRAINT)) throw error;

        this.logger.warn(`Order number collision on attempt ${attempt}`);
      }
    }

    throw new OrderNumberExhaustedError(ORDER_NUMBER_ATTEMPTS);
  }

  /**
   * The trap.
   *
   * postgres-error.mapper.ts turns every 23505 into ALREADY_EXISTS / 409, and
   * that is the right answer for a duplicate coupon code — an admin typed a
   * code that is taken, and the fix is to type another one. It is exactly
   * wrong for this one: a duplicate idempotency key means the customer's order
   * was already placed, most likely by their own retry, and the correct answer
   * is the order, not an error.
   *
   * So the catch has to be here, keyed on the constraint name, and it has to
   * run before the exception reaches the global filter. Keying on the
   * constraint rather than on the bare 23505 matters too: an order insert can
   * violate other unique constraints (the order number, today), and treating
   * those as "already placed" would return a stranger's order.
   *
   * @returns the existing order if this failure was a duplicate submission.
   */
  private async replayOf(error: unknown, idempotencyKey: string): Promise<OrderRow | undefined> {
    if (!isUniqueViolationOn(error, IDEMPOTENCY_CONSTRAINT)) return undefined;

    const existing = await this.findByIdempotencyKey(idempotencyKey);

    // The row must exist — the constraint just told us so — unless the winning
    // transaction has not committed yet, which the read-committed snapshot of
    // *this* query can genuinely miss by a hair. Rethrowing surfaces it as a
    // 409 the client may retry, rather than as a fabricated success.
    if (!existing) {
      this.logger.warn(`Idempotency key ${idempotencyKey} conflicted but no order was readable`);
    }

    return existing;
  }

  private async findByIdempotencyKey(key: string): Promise<OrderRow | undefined> {
    return this.findOrder(eq(orders.idempotencyKey, key));
  }

  private async findById(id: string): Promise<OrderRow | undefined> {
    return this.findOrder(eq(orders.id, id));
  }

  /**
   * Always the root db, never the checkout transaction — it reads committed
   * state, and reading an order back through the transaction that is still
   * writing it would show a row that does not exist yet from anyone else's
   * point of view.
   */
  private async findOrder(where: SQL): Promise<OrderRow | undefined> {
    return findOrder(this.dbService.db, where);
  }
}

/** Drizzle names a column-level unique constraint `<table>_<column>_unique`. */
const IDEMPOTENCY_CONSTRAINT = "orders_idempotency_key_unique";
const ORDER_NUMBER_CONSTRAINT = "orders_order_number_unique";

const UNIQUE_VIOLATION = "23505";

/**
 * A 23505 raised by one specific constraint.
 *
 * Deliberately not exported from common/errors: the point of this helper is
 * that catching a unique violation is a *local* decision about one constraint
 * whose meaning the calling service knows. A shared "isDuplicate(error)" would
 * invite exactly the collapse that postgres-error.mapper's blanket 23505 rule
 * already makes tempting.
 */
function isUniqueViolationOn(error: unknown, constraint: string): boolean {
  return (
    isPostgresError(error) &&
    error.code === UNIQUE_VIOLATION &&
    error.constraint_name === constraint
  );
}
