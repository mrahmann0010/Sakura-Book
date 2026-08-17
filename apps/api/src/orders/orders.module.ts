import { Module } from "@nestjs/common";
import { CouponsModule } from "../coupons";
import { InventoryModule } from "../inventory";
import { PricingModule } from "../pricing";
import { CheckoutService } from "./checkout.service";
import { OrdersController } from "./orders.controller";

/**
 * Checkout, and the order lifecycle.
 *
 * The imports are the checkout transaction's participants, and the direction
 * is one-way: orders depends on pricing, inventory and coupons, and none of
 * them knows an order exists. That is what lets each of those be exercised —
 * and tested — without standing up a checkout.
 */
@Module({
  imports: [PricingModule, InventoryModule, CouponsModule],
  controllers: [OrdersController],
  providers: [CheckoutService],
  exports: [CheckoutService],
})
export class OrdersModule {}
