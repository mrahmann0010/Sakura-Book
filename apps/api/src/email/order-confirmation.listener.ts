import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { eq } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { orders } from "../db/schema";
import { ORDER_STATUS_CHANGED } from "../common/events";
// A value import, unlike SalesRollupListener's — safe here because, unlike
// inventory, orders never imports email, so there is no cycle to close.
import { findOrder, type OrderStatusChangedEvent } from "../orders";
import { EmailService } from "./email.service";
import { orderConfirmationEmail } from "./templates/order-confirmation.template";

/**
 * Sends the payment-confirmation email once an order reaches
 * PAYMENT_CONFIRMED — the same trigger and the same after-commit,
 * fire-and-log-on-failure shape as SalesRollupListener (see its comment for
 * why the emit this reacts to happens after commit rather than inside the
 * transaction).
 *
 * A failed send does not roll anything back and does not retry: the order is
 * confirmed either way, and a lost email is a support conversation
 * ("where's my confirmation") rather than a lost sale. If that stops being an
 * acceptable failure mode, the fix is a durable queue, not a bigger try/catch
 * here.
 */
@Injectable()
export class OrderConfirmationListener {
  private readonly logger = new Logger(OrderConfirmationListener.name);

  constructor(
    private readonly dbService: DbService,
    private readonly emailService: EmailService,
  ) {}

  @OnEvent(ORDER_STATUS_CHANGED)
  async onStatusChanged(event: OrderStatusChangedEvent): Promise<void> {
    if (event.to !== "PAYMENT_CONFIRMED") return;

    try {
      const order = await findOrder(this.dbService.db, eq(orders.id, event.orderId));

      // The order existed moments ago to fire this event; a missing row here
      // means something else already logged the real problem.
      if (!order) return;

      const { subject, html } = orderConfirmationEmail(order);

      await this.emailService.send({
        to: order.customerEmail,
        toName: order.customerName,
        subject,
        html,
      });
    } catch (error) {
      this.logger.error(
        `Confirmation email failed for order ${event.orderNumber}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
