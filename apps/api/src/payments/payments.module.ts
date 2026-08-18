import { Module, type OnModuleInit } from "@nestjs/common";
import { OrdersModule } from "../orders";
import { PaymentProviderRegistry } from "./payment-provider.registry";
import { PaymentsService } from "./payments.service";
import { CashOnDeliveryProvider } from "./providers/cash-on-delivery.provider";
import { ManualTransferProvider } from "./providers/manual-transfer.provider";
import { WebhooksController } from "./webhooks.controller";

/**
 * Taking money, abstracted behind a port.
 *
 * Imports orders and is imported by nothing — payments is a leaf that depends
 * on the order lifecycle, never the reverse. Checkout does not know this module
 * exists, which is what lets a gateway be added without touching the
 * transaction that writes orders.
 */
@Module({
  imports: [OrdersModule],
  controllers: [WebhooksController],
  providers: [
    PaymentsService,
    PaymentProviderRegistry,
    CashOnDeliveryProvider,
    ManualTransferProvider,
  ],
  exports: [PaymentsService],
})
export class PaymentsModule implements OnModuleInit {
  constructor(
    private readonly registry: PaymentProviderRegistry,
    private readonly cashOnDelivery: CashOnDeliveryProvider,
    private readonly manualTransfer: ManualTransferProvider,
  ) {}

  /**
   * Registration is explicit rather than discovered by scanning for a
   * decorator. Adding a provider should be a line here — a place where someone
   * reading the module can see every way this shop can be paid — rather than a
   * side effect of a file existing somewhere.
   */
  onModuleInit(): void {
    this.registry.register(this.cashOnDelivery);
    this.registry.register(this.manualTransfer);
  }
}
