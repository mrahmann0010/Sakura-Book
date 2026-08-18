import { Module } from "@nestjs/common";
import { CatalogModule } from "../catalog";
import { CouponsModule } from "../coupons";
import { ShippingModule } from "../shipping";
import { CartController } from "./cart.controller";
import { PricingService } from "./pricing.service";

/**
 * Pricing owns every number that appears on a cart or an order total.
 *
 * It reads from three others (catalog for line prices, coupons for discounts,
 * shipping for postage) and writes nothing, which is why it can stay
 * outside the checkout transaction: quoting a cart is a pure read, and
 * checkout re-runs the same computation inside its own transaction rather
 * than trusting a quote the client hands back.
 */
@Module({
  imports: [CatalogModule, CouponsModule, ShippingModule],
  controllers: [CartController],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
