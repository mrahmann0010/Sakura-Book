import { Module } from "@nestjs/common";
import { CouponsModule } from "../coupons";
import { InventoryModule } from "../inventory";
import { PricingModule } from "../pricing";
import { ShippingModule } from "../shipping";
import { CheckoutService } from "./checkout.service";
import { GuestOrdersController } from "./guest-orders.controller";
import { OrdersService } from "./orders.service";
import { PaymentVerificationLogService } from "./payment-verification-log.service";

/**
 * Checkout, and the order lifecycle.
 *
 * The imports are the checkout transaction's participants, and the direction
 * is one-way: orders depends on pricing, inventory and coupons, and none of
 * them knows an order exists. That is what lets each of those be exercised —
 * and tested — without standing up a checkout.
 */
@Module({
  imports: [PricingModule, InventoryModule, CouponsModule, ShippingModule],
  controllers: [GuestOrdersController],
  providers: [CheckoutService, OrdersService, PaymentVerificationLogService],
  // The log is exported because the admin desk both writes to it (a staff
  // member pressing Verify) and reads it (the queue's badges). It stays
  // defined here, with the table it writes, rather than in the panel — the
  // automatic check at checkout writes to it too.
  exports: [CheckoutService, OrdersService, PaymentVerificationLogService],
})
export class OrdersModule {}
