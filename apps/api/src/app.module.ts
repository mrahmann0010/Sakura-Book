import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { join } from "node:path";
import { CommonModule } from "./common/common.module";
import { validateEnv } from "./config/env.schema";
import { CatalogModule } from "./catalog";
import { CouponsModule } from "./coupons";
import { DbModule } from "./db/db.module";
import { HealthModule } from "./health/health.module";
import { InventoryModule } from "./inventory";
import { OrdersModule } from "./orders";
import { PaymentsModule } from "./payments";
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

    HealthModule,
  ],
})
export class AppModule {}
