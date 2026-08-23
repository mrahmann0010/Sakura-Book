import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PAYMENT_NUMBERS_CONFIG, paymentNumbersConfigFrom } from "../config/payment-numbers.config";
import { PaymentNumbersController } from "./payment-numbers.controller";
import { PaymentNumbersService } from "./payment-numbers.service";

/**
 * The bKash/Rocket/Nagad receiving numbers shown at checkout: the public read
 * this exposes, and the service AdminSettingsModule wraps for the panel's
 * write.
 *
 * Separate from PaymentsModule (the gateway/webhook module next to this one)
 * deliberately — that module takes money and depends on OrdersModule; this
 * one only serves the numbers a customer sends money to out of band, and has
 * no reason to know an order exists.
 */
@Module({
  controllers: [PaymentNumbersController],
  providers: [
    {
      provide: PAYMENT_NUMBERS_CONFIG,
      useFactory: paymentNumbersConfigFrom,
      inject: [ConfigService],
    },
    PaymentNumbersService,
  ],
  exports: [PaymentNumbersService],
})
export class PaymentNumbersModule {}
