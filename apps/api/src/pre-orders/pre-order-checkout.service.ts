import { Injectable, Logger } from "@nestjs/common";
import type { PlacePreOrderRequest, PreOrder } from "@sakura/contracts";
import { eq } from "drizzle-orm";
import { isPostgresError } from "../common/errors";
import { generateOrderNumber, ORDER_NUMBER_ATTEMPTS } from "../orders";
import { DbService } from "../db/db.service";
import type { Transaction } from "../db/db.types";
import { preOrderOrders } from "../db/schema";
import { PreOrderBooksService } from "./pre-order-books.service";
import { toPreOrderResponse, type PreOrderRow } from "./pre-order.mapper";

/**
 * Placing a pre-order — the simplified sibling of CheckoutService.
 *
 * Simpler on purpose: no catalog re-pricing (the book is snapshotted, not
 * repriced against a cart), no stock decrement, no coupon. What is kept is the
 * part that actually matters for correctness: the total is computed here,
 * from the pre-order book's current price times the requested quantity, and
 * never from anything the client sent — and the Idempotency-Key header still
 * makes a double-click produce one order, not two.
 */
@Injectable()
export class PreOrderCheckoutService {
  private readonly logger = new Logger(PreOrderCheckoutService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly preOrderBooksService: PreOrderBooksService,
  ) {}

  async placePreOrder(
    request: PlacePreOrderRequest,
    idempotencyKey: string,
  ): Promise<{ preOrder: PreOrder; created: boolean }> {
    const existing = await this.findByIdempotencyKey(idempotencyKey);
    if (existing) return { preOrder: toPreOrderResponse(existing), created: false };

    try {
      const id = await this.dbService.db.transaction((tx) =>
        this.writePreOrder(request, idempotencyKey, tx),
      );

      const created = await this.findById(id);
      if (!created) throw new Error(`Pre-order ${id} vanished after commit`);

      return { preOrder: toPreOrderResponse(created), created: true };
    } catch (error) {
      const replayed = await this.replayOf(error, idempotencyKey);
      if (replayed) return { preOrder: toPreOrderResponse(replayed), created: false };
      throw error;
    }
  }

  private async writePreOrder(
    request: PlacePreOrderRequest,
    idempotencyKey: string,
    tx: Transaction,
  ): Promise<string> {
    const book = await this.preOrderBooksService.findRowById(request.preOrderBookId, tx);

    const unitPriceCents = book.priceCents;
    const subtotalCents = unitPriceCents * request.quantity;
    // No shipping, no coupon — subtotal and total are the same figure today.
    // Kept as two columns (matching orders.subtotalCents/totalCents) so a
    // delivery charge can be added later without a schema change.
    const totalCents = subtotalCents;

    const { customer } = request;

    const values = {
      preOrderBookId: book.id,
      bookTitleSnapshot: book.title,
      authorNameSnapshot: book.authorName,
      unitPriceCents,
      quantity: request.quantity,
      subtotalCents,
      totalCents,
      customerName: customer.fullName,
      customerEmail: customer.email,
      customerPhone: customer.phone,
      shippingAddress: {
        address: customer.address,
        city: customer.city,
        region: customer.region,
      },
      customerNote: request.note ?? null,
      paymentMethod: request.method,
      senderNumber: request.senderNumber ?? null,
      transactionId: request.transactionId ?? null,
      idempotencyKey,
    };

    for (let attempt = 1; attempt <= ORDER_NUMBER_ATTEMPTS; attempt++) {
      try {
        const [inserted] = await tx
          .insert(preOrderOrders)
          .values({ ...values, orderNumber: generateOrderNumber() })
          .returning({ id: preOrderOrders.id });

        return inserted.id;
      } catch (error) {
        if (!isUniqueViolationOn(error, ORDER_NUMBER_CONSTRAINT)) throw error;
        this.logger.warn(`Pre-order number collision on attempt ${attempt}`);
      }
    }

    throw new Error(`Exhausted ${ORDER_NUMBER_ATTEMPTS} pre-order number attempts`);
  }

  private async replayOf(error: unknown, idempotencyKey: string): Promise<PreOrderRow | undefined> {
    if (!isUniqueViolationOn(error, IDEMPOTENCY_CONSTRAINT)) return undefined;

    const existing = await this.findByIdempotencyKey(idempotencyKey);

    if (!existing) {
      this.logger.warn(`Idempotency key ${idempotencyKey} conflicted but no pre-order was readable`);
    }

    return existing;
  }

  private async findByIdempotencyKey(key: string): Promise<PreOrderRow | undefined> {
    const [row] = await this.dbService.db
      .select()
      .from(preOrderOrders)
      .where(eq(preOrderOrders.idempotencyKey, key))
      .limit(1);

    return row;
  }

  private async findById(id: string): Promise<PreOrderRow | undefined> {
    const [row] = await this.dbService.db
      .select()
      .from(preOrderOrders)
      .where(eq(preOrderOrders.id, id))
      .limit(1);

    return row;
  }
}

const IDEMPOTENCY_CONSTRAINT = "pre_order_orders_idempotency_key_unique";
const ORDER_NUMBER_CONSTRAINT = "pre_order_orders_order_number_unique";
const UNIQUE_VIOLATION = "23505";

function isUniqueViolationOn(error: unknown, constraint: string): boolean {
  return (
    isPostgresError(error) &&
    error.code === UNIQUE_VIOLATION &&
    error.constraint_name === constraint
  );
}
