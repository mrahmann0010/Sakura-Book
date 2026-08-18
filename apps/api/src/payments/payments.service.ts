import { Injectable, Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { isPostgresError, ResourceNotFoundError } from "../common/errors";
import { DbService } from "../db/db.service";
import { payments } from "../db/schema";
import { OrdersService } from "../orders";
import { PaymentProviderRegistry } from "./payment-provider.registry";
import { PaymentAmountMismatchError, UnknownPaymentProviderError } from "./payment.errors";
import type { PaymentProvider, WebhookEvent } from "./payment-provider.port";

/**
 * Recording payments, and deciding what a payment means for an order.
 *
 * The module depends on orders and orders knows nothing about it, which is the
 * direction the graph requires: a payment is a fact *about* an order, and an
 * order that had to know how it was paid for would drag every future gateway
 * into the checkout transaction.
 *
 * Status changes go through `OrdersService.transitionAndCommit` — never a
 * direct write to `orders.status`. That is what keeps `order_status_history`
 * the source of truth when a gateway, rather than a person, is the one moving
 * the order.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly ordersService: OrdersService,
    private readonly providers: PaymentProviderRegistry,
  ) {}

  provider(name: string): PaymentProvider {
    const provider = this.providers.get(name);

    if (!provider) throw new UnknownPaymentProviderError(name);

    return provider;
  }

  /**
   * Apply a verified webhook event.
   *
   * Idempotent by construction, because gateways retry: the unique index on
   * `(provider, provider_reference_id)` means the second delivery of the same
   * event loses the insert race, and this catches that rather than checking
   * first — a check-then-insert loses to a concurrent redelivery, which is
   * exactly what a retry storm is.
   *
   * Returns whether the order was moved, so the controller can answer 200 to a
   * replay without pretending it did the work twice.
   */
  async applyWebhook(providerName: string, event: WebhookEvent): Promise<{ confirmed: boolean }> {
    const order = await this.dbService.db.query.orders.findFirst({
      where: (row, { eq: equals }) => equals(row.orderNumber, event.referenceId),
      columns: { id: true, orderNumber: true, totalCents: true, status: true },
    });

    // The reference is the order number for both manual methods; a gateway
    // would carry its own, at which point this becomes a lookup on the payment
    // row instead. Not found is a 404 rather than a silent 200: an event for an
    // order we do not have means the two systems disagree about reality, and
    // swallowing it hides that.
    if (!order) throw new ResourceNotFoundError("Order", event.referenceId);

    /**
     * Amount check before anything is recorded. A payment smaller than the
     * total is either partial or tampered with, and confirming on either ships
     * goods that were not paid for. Note this compares against the order's
     * stored total, not against anything in the payload.
     */
    if (event.status === "SUCCEEDED" && event.amountCents !== order.totalCents) {
      this.logger.error(
        `Payment amount mismatch on ${order.orderNumber}: expected ${order.totalCents}, got ${event.amountCents}`,
      );

      throw new PaymentAmountMismatchError(order.orderNumber, order.totalCents, event.amountCents);
    }

    const recorded = await this.record(providerName, event, order.id);

    if (!recorded) {
      this.logger.log(`Replayed ${providerName} webhook for ${order.orderNumber}; ignoring`);

      return { confirmed: false };
    }

    if (event.status !== "SUCCEEDED") return { confirmed: false };

    // Its own transaction, and after the payment row is committed. If the
    // transition fails — the order was cancelled a moment ago, say — the
    // payment is still on record, which is the correct outcome: money arrived
    // for an order that cannot proceed, and that is a refund conversation, not
    // a lost payment.
    await this.ordersService.transitionAndCommit(
      order.id,
      "PAYMENT_CONFIRMED",
      `Payment confirmed via ${providerName}`,
    );

    return { confirmed: true };
  }

  /**
   * Insert the payment row, or report that this event was already applied.
   *
   * @returns false when the unique index rejected it as a duplicate.
   */
  private async record(
    providerName: string,
    event: WebhookEvent,
    orderId: string,
  ): Promise<boolean> {
    try {
      await this.dbService.db.insert(payments).values({
        orderId,
        provider: providerName,
        providerReferenceId: event.referenceId,
        amountCents: event.amountCents,
        status: event.status,
        rawResponse: event.raw as Record<string, unknown>,
      });

      return true;
    } catch (error) {
      // Keyed on the constraint, not on the bare 23505, for the same reason
      // checkout's idempotency catch is: an insert can violate other unique
      // constraints, and treating those as "already handled" would swallow a
      // real failure.
      if (isPostgresError(error) && error.code === "23505") {
        return false;
      }

      throw error;
    }
  }

  /** Payments recorded against an order, oldest first. */
  async forOrder(orderId: string) {
    return this.dbService.db
      .select()
      .from(payments)
      .where(eq(payments.orderId, orderId))
      .orderBy(payments.createdAt);
  }
}
