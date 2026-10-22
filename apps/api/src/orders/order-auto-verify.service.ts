import { Injectable, Logger } from "@nestjs/common";
import type { Order } from "@sakura/contracts";
import { eq } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { orders } from "../db/schema";
import { PaymentsService } from "../payments";
import type { ClaimOutcome } from "@project-sakura/pay";
import { toOrderResponse, type OrderRow } from "./order.mapper";
import { OrderPaymentClaimService } from "./order-payment-claim.service";
import { findOrder } from "./order.query";
import { findTransactionIdClaim, RELEASED_STATUSES } from "./transaction-id-claim";

/** How soon to retry when the payment was claimed but the order could not be granted. */
const GRANT_RETRY_SECONDS = 30;

/**
 * The automated half of payment confirmation.
 *
 * Claims a manual-transfer order's payment at the gateway, and on CLAIMED
 * grants the order through `PaymentsService.confirmManually` — the same door
 * a signed-in admin uses. Runs once inside checkout, and again from the
 * background retry worker while the payment SMS is still on its way.
 *
 * ## Never fails the checkout it rides on
 *
 * Every failure here — not arrived yet, gateway unreachable, a race with an
 * admin confirming the same order — is swallowed and leaves the order where
 * it was: PENDING, for a retry or a person. This runs *after* the order has
 * committed; no outcome here should turn a placed order into an error.
 */
@Injectable()
export class OrderAutoVerifyService {
  private readonly logger = new Logger(OrderAutoVerifyService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly orderClaims: OrderPaymentClaimService,
    private readonly paymentsService: PaymentsService,
  ) {}

  /**
   * The checkout's single, immediate try.
   *
   * @returns the order, re-read if this call granted it, unchanged otherwise.
   */
  async tryAutoConfirm(order: Order): Promise<Order> {
    // Only manual-transfer orders carry a payment to claim.
    if (order.paymentMethod !== "manual-transfer") return order;

    const row = await findOrder(this.dbService.db, eq(orders.orderNumber, order.orderNumber));
    if (!row) return order;

    const outcome = await this.settle(row);
    if (outcome?.outcome !== "CLAIMED") return order;

    const confirmed = await findOrder(this.dbService.db, eq(orders.orderNumber, order.orderNumber));

    return confirmed ? toOrderResponse(confirmed) : order;
  }

  /**
   * Claim this order's payment and, if the order is still PENDING, grant it.
   *
   * Also used for orders staff already confirmed with a reason while the
   * gateway could not answer: those are only claimed, so the payment is
   * marked spent once it arrives.
   *
   * Never throws. Returns what the gateway said, or null when no claim was
   * made.
   */
  async settle(row: OrderRow): Promise<ClaimOutcome | null> {
    try {
      if (!OrderPaymentClaimService.isClaimable(row) || RELEASED_STATUSES.includes(row.status)) {
        await this.orderClaims.clearRetry(row.id);
        return null;
      }

      /* Our own check before the gateway's. Checkout refuses a reused receipt
         before the order exists, so reaching this normally means two
         checkouts committed in the same instant. An automated grant is the
         last thing that should happen then: no human is watching this path. */
      if (row.status === "PENDING") {
        const holder = await findTransactionIdClaim(this.dbService.db, row.transactionId, {
          excludeOrderId: row.id,
        });

        if (holder) {
          this.logger.error(
            `Auto-confirm refused for ${row.orderNumber}: its transaction ID is already recorded ` +
              `against ${holder.orderNumber}. Leaving it pending for review.`,
          );
          await this.orderClaims.clearRetry(row.id);
          return null;
        }
      }

      const { outcome } = await this.orderClaims.claim(row, null);

      if (outcome.outcome !== "CLAIMED") {
        if (row.status !== "PENDING" && outcome.outcome === "ALREADY_CLAIMED") {
          /* The case the staff override warned about: the order was confirmed
             before the gateway saw the payment, and someone else has since
             spent it. The order now shows "Spent elsewhere" on the queue. */
          this.logger.error(
            `Order ${row.orderNumber} was confirmed without a gateway claim, and payment ` +
              `${row.transactionId} has since been claimed by another order or business. ` +
              `The owner needs to review it.`,
          );
        }

        return outcome;
      }

      // Already confirmed by staff: the claim was all that was missing.
      if (row.status !== "PENDING") return outcome;

      try {
        await this.paymentsService.confirmManually(row.paymentMethod, {
          referenceId: row.orderNumber,
          status: "SUCCEEDED",
          /* The order's own total, not the paid amount: confirmManually checks
             for exact equality against `orders.total_cents`, and the gateway
             has already established paid >= expected. An overpayment is kept
             on the claim's log row and flagged on the order for a refund or
             credit. */
          amountCents: row.totalCents,
          raw: {
            source: "gateway-claim",
            transactionId: outcome.trxId,
            claimKey: row.paymentClaimKey,
            paidCents: outcome.paidPoisha,
            overpaidCents: outcome.overpaidPoisha,
            claimedAt: outcome.claimedAt.toISOString(),
          },
        });
      } catch (error) {
        /* The payment is ours at the gateway but the order did not move.
           Retrying with the same key replays the claim, so try again shortly. */
        this.logger.error(
          `Claimed ${row.orderNumber}'s payment but could not confirm the order; retrying: ${String(error)}`,
        );
        await this.orderClaims.scheduleRetry(row.id, GRANT_RETRY_SECONDS);
      }

      return outcome;
    } catch (error) {
      this.logger.error(
        `Auto-confirm failed for ${row.orderNumber}; leaving it for review: ${String(error)}`,
      );

      return null;
    }
  }
}
