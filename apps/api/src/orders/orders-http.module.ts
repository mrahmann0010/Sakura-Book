import { Module } from "@nestjs/common";
import { PaymentsModule } from "../payments";
import { OrderAutoVerifyService } from "./order-auto-verify.service";
import { OrdersController } from "./orders.controller";
import { OrdersModule } from "./orders.module";

/**
 * The customer-facing checkout route, and the one place allowed to depend on
 * both order placement and payment confirmation.
 *
 * `PaymentsModule` already depends on `OrdersModule` — a payment is a fact
 * *about* an order — and `OrdersModule` importing `PaymentsModule` back would
 * turn that into a cycle. This module sits above both instead, and nothing
 * imports it in turn, so `POST /orders` can place an order and then,
 * best-effort, ask payments to confirm it, without either module knowing the
 * other exists.
 */
@Module({
  imports: [OrdersModule, PaymentsModule],
  controllers: [OrdersController],
  providers: [OrderAutoVerifyService],
})
export class OrdersHttpModule {}
