import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { join } from "node:path";
import { CommonModule } from "./common/common.module";
import { validateEnv } from "./config/env.schema";
import { CouponsModule } from "./coupons/coupons.module";
import { DbModule } from "./db/db.module";
import { HealthModule } from "./health/health.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // The monorepo keeps one .env at the repo root, shared with docker compose.
      envFilePath: [join(__dirname, "..", "..", "..", ".env")],
      validate: validateEnv,
    }),
    CommonModule,
    DbModule,
    CouponsModule,
    HealthModule,
  ],
})
export class AppModule {}
