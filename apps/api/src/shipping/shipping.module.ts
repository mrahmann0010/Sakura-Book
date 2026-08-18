import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SHIPPING_CONFIG, shippingConfigFrom } from "../config/shipping.config";
import { RegionsService } from "./regions.service";
import { ShippingController } from "./shipping.controller";
import { ShippingPolicy } from "./shipping.policy";

/**
 * Postage: what it costs, when it is waived, and where the shop delivers.
 *
 * Split out of `pricing` once regions gained their own table. Pricing depends
 * on shipping and not the reverse — the postage rules have no idea a cart or a
 * coupon exists, which is what keeps ShippingPolicy a pure function of numbers
 * and therefore the piece the money tests can pin without a database.
 */
@Module({
  controllers: [ShippingController],
  providers: [
    {
      provide: SHIPPING_CONFIG,
      useFactory: shippingConfigFrom,
      inject: [ConfigService],
    },
    ShippingPolicy,
    RegionsService,
  ],
  exports: [ShippingPolicy, RegionsService],
})
export class ShippingModule {}
