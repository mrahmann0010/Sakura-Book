import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { join } from "node:path";
import { CommonModule } from "./common/common.module";
import { validateEnv } from "./config/env.schema";
import { AdminModule } from "./admin";
import { CatalogModule } from "./catalog";
import { CouponsModule } from "./coupons";
import { DbModule } from "./db/db.module";
import { HealthModule } from "./health/health.module";
import { InventoryModule } from "./inventory";
import { OrdersModule } from "./orders";
import { PaymentsModule } from "./payments";
import { PreOrdersModule } from "./pre-orders";
import { PricingModule } from "./pricing";
import { ShippingModule } from "./shipping";

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

    CatalogModule,
    CouponsModule,
    InventoryModule,
    ShippingModule,
    PricingModule,
    OrdersModule,
    PaymentsModule,
    PreOrdersModule,

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
