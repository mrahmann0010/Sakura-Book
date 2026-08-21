import { Module } from "@nestjs/common";
import { PreOrderBooksController } from "./pre-order-books.controller";
import { PreOrderBooksService } from "./pre-order-books.service";
import { PreOrderCheckoutService } from "./pre-order-checkout.service";
import { PreOrdersController } from "./pre-orders.controller";

@Module({
  controllers: [PreOrderBooksController, PreOrdersController],
  providers: [PreOrderBooksService, PreOrderCheckoutService],
  // Exported so AdminModule's pre-order feature can read the active book
  // through the same service the storefront uses, rather than a second copy.
  exports: [PreOrderBooksService],
})
export class PreOrdersModule {}
