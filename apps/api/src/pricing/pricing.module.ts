import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CatalogModule } from "../catalog";
import { SHIPPING_CONFIG, shippingConfigFrom } from "../config/shipping.config";
import { CouponsModule } from "../coupons";
import { CartController } from "./cart.controller";
import { PricingService } from "./pricing.service";
import { ShippingPolicy } from "./shipping.policy";

/**
 * Pricing owns every number that appears on a cart or an order total.
 *
 * It is the one module that reads from two others (catalog for line prices,
 * coupons for discounts) without writing anything, which is why it can stay
 * outside the checkout transaction: quoting a cart is a pure read, and
 * checkout re-runs the same computation inside its own transaction rather
 * than trusting a quote the client hands back.
 */
@Module({
  imports: [CatalogModule, CouponsModule],
  controllers: [CartController],
  providers: [
    {
      provide: SHIPPING_CONFIG,
      useFactory: shippingConfigFrom,
      inject: [ConfigService],
    },
    ShippingPolicy,
    PricingService,
  ],
  exports: [ShippingPolicy, PricingService],
})
export class PricingModule {}
