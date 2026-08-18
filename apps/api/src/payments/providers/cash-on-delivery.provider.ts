import { Injectable } from "@nestjs/common";
import type { PaymentMethod } from "@sakura/contracts";
import type {
  PaymentContext,
  PaymentIntent,
  PaymentProvider,
  WebhookEvent,
} from "../payment-provider.port";

/**
 * Cash on delivery.
 *
 * There is no gateway, no redirect and nothing for the customer to do at
 * checkout — the courier collects. `initiate` exists so that every order gets a
 * payment row with a reference from the moment it is placed, which is what
 * makes "which orders are unpaid" one query rather than a join against payment
 * method and a rule in someone's head.
 *
 * **On what PAYMENT_CONFIRMED means here.** The money arrives at the door, but
 * the status machine puts PAYMENT_CONFIRMED before PROCESSING and SHIPPED, so a
 * COD order that is never confirmed can never be picked. The reading is that
 * for COD the transition means *the order is accepted for fulfilment* — the
 * shop has agreed to send it and collect on arrival — while the money itself is
 * tracked by `payments.status`, which stays PENDING until the courier settles.
 * That is why both exist: the order's status is about fulfilment, the payment
 * row is about cash. Confirming a COD order is therefore a staff action, and
 * until the admin surface exists nothing performs it.
 */
@Injectable()
export class CashOnDeliveryProvider implements PaymentProvider {
  readonly name = "cash-on-delivery";
  readonly method: PaymentMethod = "cash-on-delivery";

  initiate(context: PaymentContext): PaymentIntent {
    return {
      // No gateway to mint one, and the order number is already unique — which
      // also makes the unique index on (provider, reference) do useful work
      // here: one COD payment row per order, enforced.
      referenceId: context.orderNumber,
      action: "none",
    };
  }

  /**
   * Nothing posts webhooks for cash. Throwing rather than returning a benign
   * value because a request arriving here means either a misrouted gateway or
   * someone testing what `/payments/cash-on-delivery/webhook` does, and both
   * should be refused rather than quietly accepted.
   */
  verifyWebhook(): WebhookEvent {
    throw new Error("cash-on-delivery does not receive webhooks");
  }
}
