import { Module } from "@nestjs/common";
import { CouponsModule } from "../coupons";
import { InventoryModule } from "../inventory";
import { PricingModule } from "../pricing";
import { ShippingModule } from "../shipping";
import { WaitlistModule } from "../waitlist";
import { CheckoutService } from "./checkout.service";
import { GuestOrdersController } from "./guest-orders.controller";
import { OrdersService } from "./orders.service";
import { OrderPaymentClaimService } from "./order-payment-claim.service";
import { PAYMENT_GATEWAY, paymentGatewayProvider } from "./payment-gateway.provider";
import { PaymentVerificationLogService } from "./payment-verification-log.service";

/**
 * Checkout, and the order lifecycle.
 *
 * The imports are the checkout transaction's participants, and the direction
 * is one-way: orders depends on pricing, inventory, coupons and now the
 * waitlist invite token, and none of them knows an order exists. That is
 * what lets each of those be exercised — and tested — without standing up a
 * checkout.
 */
@Module({
  imports: [PricingModule, InventoryModule, CouponsModule, ShippingModule, WaitlistModule],
  controllers: [GuestOrdersController],
  providers: [
    CheckoutService,
    OrdersService,
    PaymentVerificationLogService,
    OrderPaymentClaimService,
    paymentGatewayProvider,
  ],
  // The log is exported because the admin desk both writes to it (a staff
  // member pressing Verify) and reads it (the queue's badges). It stays
  // defined here, with the table it writes, rather than in the panel — the
  // automatic check at checkout writes to it too.
  // The claim service is exported for the same reason: the desk's confirm
  // actions claim the payment through it, exactly as checkout does.
  // The gateway client is exported for the retry worker in OrdersHttpModule,
  // which only reads `enabled`.
  exports: [
    CheckoutService,
    OrdersService,
    PaymentVerificationLogService,
    OrderPaymentClaimService,
    PAYMENT_GATEWAY,
  ],
})
export class OrdersModule {}
