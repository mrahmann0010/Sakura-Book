import { Injectable, Logger } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { isPostgresError, ResourceNotFoundError } from "../common/errors";
import { DbService } from "../db/db.service";
import type { Transaction } from "../db/db.types";
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
    return this.apply(providerName, event);
  }

  /**
   * Record a payment a member of staff matched by hand.
   *
   * Bank and bKash transfers arrive out of band: the customer pays, quotes the
   * order number, and someone at the shop finds it on a statement. That is a
   * *fact about a payment* reported by a trusted party, which is exactly what
   * the provider port describes — so it goes down the same path a gateway
   * webhook does rather than getting a private one.
   *
   * That equivalence is the point. The amount check, the duplicate-reference
   * index, the "record the payment before transitioning" ordering and the
   * decision that a payment for a dead order stays on the books all apply
   * unchanged, because they are properties of confirming a payment and not of
   * the transport it arrived over. A separate admin implementation would have
   * had to re-derive every one of them, and would have got one wrong.
   *
   * What differs is only the authentication: a webhook proves itself with an
   * HMAC, and this proves itself with a signed-in admin and an audit entry
   * written by the caller.
   */
  async confirmManually(
    providerName: string,
    event: WebhookEvent,
  ): Promise<{ confirmed: boolean }> {
    return this.apply(providerName, event);
  }

  private async apply(providerName: string, event: WebhookEvent): Promise<{ confirmed: boolean }> {
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
      this.logger.log(`Replayed ${providerName} confirmation for ${order.orderNumber}; ignoring`);

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

  /**
   * Record a refund against an order.
   *
   * A row, not a transfer. Nothing here calls a gateway — the manual methods
   * have none, and the money is moved by a person at the shop. This is the
   * record that they did, and the order's transition to REFUNDED is the
   * caller's to make.
   *
   * `Transaction`, because a refund row and the status change that explains it
   * are one fact: a REFUNDED order with no refund row is a customer whose
   * money nobody can account for, and a refund row on an order that never
   * reached REFUNDED is worse.
   */
  async recordRefund(
    orderId: string,
    input: { providerName: string; amountCents: number; reference: string; raw?: unknown },
    tx: Transaction,
  ): Promise<void> {
    await tx.insert(payments).values({
      orderId,
      provider: input.providerName,
      // Distinct from the original payment's reference, which is still in the
      // table — the unique index on (provider, provider_reference_id) would
      // otherwise reject the refund as a duplicate of the payment it reverses.
      providerReferenceId: `refund:${input.reference}`,
      amountCents: input.amountCents,
      status: "REFUNDED",
      rawResponse: (input.raw ?? {}) as Record<string, unknown>,
    });
  }

  /**
   * Withdraw the successful payments recorded against an order.
   *
   * The half of a reverted confirmation that is easy to forget and expensive
   * to skip. `record` keys idempotency on `(provider, provider_reference_id)`,
   * and for both manual methods the reference *is* the order number — so a
   * revert that left the row alone would leave the order permanently
   * unconfirmable: the customer pays for real, staff press Confirm, the insert
   * loses to the old row, `apply` reports a replay and the order sits in
   * PENDING with nothing to say why.
   *
   * So the reference is rewritten as well as the status. `voided:` mirrors the
   * `refund:` prefix `recordRefund` uses and for the same reason — it frees
   * the natural key for the genuine confirmation that follows while keeping
   * the original reference legible inside it. The row itself is kept, never
   * deleted: what a customer's order looked like on the day is not the shop's
   * to tidy away, and `VOIDED` says exactly what happened to it.
   *
   * Only `SUCCEEDED` rows are touched. A refund row is a different fact and a
   * failed attempt was never a confirmation.
   *
   * `Transaction`, because voiding a payment and putting the order back to
   * PENDING are one act: either alone is a worse state than the mistake being
   * corrected.
   *
   * @returns how many rows were withdrawn — zero is normal for an order
   *   confirmed by transition rather than by a recorded transfer.
   */
  async voidConfirmed(
    orderId: string,
    context: { reason: string; voidedBy: string },
    tx: Transaction,
  ): Promise<number> {
    const voided = await tx
      .update(payments)
      .set({
        status: "VOIDED",
        providerReferenceId: sql`'voided:' || ${payments.id} || ':' || ${payments.providerReferenceId}`,
        rawResponse: sql`coalesce(${payments.rawResponse}, '{}'::jsonb) || ${JSON.stringify({
          voidedBy: context.voidedBy,
          voidedAt: new Date().toISOString(),
          voidReason: context.reason,
        })}::jsonb`,
      })
      .where(and(eq(payments.orderId, orderId), eq(payments.status, "SUCCEEDED")))
      .returning({ id: payments.id });

    return voided.length;
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
