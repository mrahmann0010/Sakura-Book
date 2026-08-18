import { Module } from "@nestjs/common";
import { CouponsModule } from "../coupons";
import { InventoryModule } from "../inventory";
import { PricingModule } from "../pricing";
import { ShippingModule } from "../shipping";
import { CheckoutService } from "./checkout.service";
import { GuestOrdersController } from "./guest-orders.controller";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";

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
  controllers: [OrdersController, GuestOrdersController],
  providers: [CheckoutService, OrdersService],
  exports: [CheckoutService, OrdersService],
})
export class OrdersModule {}
