import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { join } from "node:path";
import { CommonModule } from "./common/common.module";
import { validateEnv } from "./config/env.schema";
import { AdminModule } from "./admin";
import { CatalogModule } from "./catalog";
import { CouponsModule } from "./coupons";
import { AuditModule } from "./audit";
import { DbModule } from "./db/db.module";
import { EmailModule } from "./email";
import { PaymentVerificationModule } from "./payment-verification";
import { HealthModule } from "./health/health.module";
import { InventoryModule } from "./inventory";
import { OrdersModule } from "./orders";
/* eslint-disable-next-line no-restricted-imports -- the one import the barrel
   rule cannot cover: orders/index.ts deliberately does not re-export
   OrdersHttpModule (it imports PaymentsModule, which imports that same barrel
   for OrdersModule, so re-exporting would make the cycle a file-level one) and
   says to import it directly. See the comment beside the omission there. */
import { OrdersHttpModule } from "./orders/orders-http.module";
import { PaymentNumbersModule, PaymentsModule } from "./payments";
import { PricingModule } from "./pricing";
import { ShippingModule } from "./shipping";
import { ReviewsModule } from "./reviews";
import { WaitlistModule } from "./waitlist";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // apps/api owns its own .env, separate from apps/web's.
      envFilePath: [join(__dirname, "..", ".env")],
      validate: validateEnv,
    }),
    // Infrastructure first, then bounded contexts in dependency order. The
    // order is cosmetic to Nest but is the cheapest available documentation of
    // the module graph: nothing below may be imported by anything above it.
    CommonModule,
    DbModule,
    AuditModule,
    PaymentVerificationModule,
    EmailModule,

    CatalogModule,
    CouponsModule,
    InventoryModule,
    ShippingModule,
    PricingModule,
    WaitlistModule,
    ReviewsModule,
    OrdersModule,
    PaymentsModule,
    PaymentNumbersModule,
    // Above both: the checkout route needs order placement and payment
    // confirmation together, and neither of those modules is allowed to
    // depend on the other. See OrdersHttpModule's own comment.
    OrdersHttpModule,

    /**
     * Last of the bounded contexts, because admin reads and writes all of
     * them — it is the one module allowed to depend on everything above it,
     * and nothing above it may depend on admin. The day a storefront service
     * imports something from here, the arrow has been reversed and the
     * ordering in this list has stopped documenting anything.
     */
    AdminModule,

    HealthModule,
  ],
})
export class AppModule {}
