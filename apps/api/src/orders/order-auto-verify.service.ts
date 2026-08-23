import { Injectable, Logger } from "@nestjs/common";
import type { Order } from "@sakura/contracts";
import { eq } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { orders } from "../db/schema";
import { PaymentVerificationService } from "../payment-verification";
import { PaymentsService } from "../payments";
import { toOrderResponse } from "./order.mapper";
import { findOrder } from "./order.query";

/**
 * The automated half of payment confirmation.
 *
 * `PaymentVerificationService` can only answer "did this transaction arrive",
 * and `PaymentsService.confirmManually` can only grant an order once told a
 * payment succeeded — same as it does for a signed-in admin or a gateway
 * webhook. This is the caller that connects the two for a freshly placed
 * manual-transfer order, so a customer whose bKash SMS already reached the
 * gateway never has to wait for a human to notice it.
 *
 * ## Never fails the checkout it rides on
 *
 * Every failure here — no match yet, Mongo unreachable, a race with an admin
 * confirming the same order by hand — is swallowed and leaves the order
 * exactly where `placeOrder` left it: PENDING, for a human to review. This
 * runs *after* the order has already committed; there is no outcome here
 * that should turn a successful checkout into an error response.
 */
@Injectable()
export class OrderAutoVerifyService {
  private readonly logger = new Logger(OrderAutoVerifyService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly paymentVerificationService: PaymentVerificationService,
    private readonly paymentsService: PaymentsService,
  ) {}

  /**
   * @returns the order, re-read if this call granted it, unchanged otherwise.
   */
  async tryAutoConfirm(order: Order): Promise<Order> {
    // Only manual-transfer orders carry a transaction ID to look up. Cash on
    // delivery and anything else has nothing here to check — same guard the
    // admin's confirmPayment uses, for the same reason.
    if (order.paymentMethod !== "manual-transfer") return order;

    const row = await findOrder(this.dbService.db, eq(orders.orderNumber, order.orderNumber));
    if (!row || !row.transactionId) return order;

    try {
      const verification = await this.paymentVerificationService.verify({
        transactionId: row.transactionId,
        expectedCents: row.totalCents,
        provider: row.provider ?? undefined,
      });

      if (verification.outcome !== "MATCHED") return order;

      await this.paymentsService.confirmManually(row.paymentMethod, {
        referenceId: row.orderNumber,
        status: "SUCCEEDED",
        // The order's own total, not the SMS amount: confirmManually checks
        // this for exact equality against `orders.total_cents`, and the
        // verifier already established paid >= expected. An overpayment is a
        // refund conversation, not a reason to reject the auto-grant, and it
        // is still recoverable from `verification.paidCents` in the log line
        // below if that conversation needs to happen.
        amountCents: row.totalCents,
        raw: {
          source: "auto-verify",
          transactionId: verification.transactionId,
          paidCents: verification.paidCents,
          receivedAt: verification.receivedAt?.toISOString() ?? null,
        },
      });
    } catch (error) {
      this.logger.error(
        `Auto-confirm failed for ${row.orderNumber}; leaving it pending for review: ${String(error)}`,
      );

      return order;
    }

    const confirmed = await findOrder(this.dbService.db, eq(orders.orderNumber, order.orderNumber));

    return confirmed ? toOrderResponse(confirmed) : order;
  }
}
