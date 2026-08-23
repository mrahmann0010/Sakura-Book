import { Module } from "@nestjs/common";
import { EmailService } from "./email.service";
import { OrderConfirmationListener } from "./order-confirmation.listener";

/**
 * Transactional email. No controller — every send today is a reaction to a
 * domain event, not a request anyone makes of this module directly.
 *
 * OrderConfirmationListener needs no explicit import of OrdersModule: it
 * reaches order data through DbService directly (global, via DbModule) and
 * reaches the event through EventEmitterModule.forRoot() (global, via
 * CommonModule) — the same wiring that lets InventoryModule's
 * SalesRollupListener react to orders without orders depending on it.
 */
@Module({
  providers: [EmailService, OrderConfirmationListener],
  exports: [EmailService],
})
export class EmailModule {}
