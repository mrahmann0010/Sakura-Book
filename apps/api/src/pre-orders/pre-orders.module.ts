import { Module } from "@nestjs/common";
import { PreOrderBooksController } from "./pre-order-books.controller";
import { PreOrderBooksService } from "./pre-order-books.service";
import { PreOrderCheckoutService } from "./pre-order-checkout.service";
import { PreOrderPaymentVerificationService } from "./pre-order-payment-verification.service";
import { PreOrdersController } from "./pre-orders.controller";

@Module({
  controllers: [PreOrderBooksController, PreOrdersController],
  providers: [PreOrderBooksService, PreOrderCheckoutService, PreOrderPaymentVerificationService],
  /**
   * Both consumed by AdminModule, which imports this module.
   *
   * PreOrderPaymentVerificationService in particular: the desk's "re-check
   * payment" button runs the same code path as the automatic check at
   * placement, rather than a second implementation that could drift from it.
   */
  exports: [PreOrderBooksService, PreOrderPaymentVerificationService],
})
export class PreOrdersModule {}
