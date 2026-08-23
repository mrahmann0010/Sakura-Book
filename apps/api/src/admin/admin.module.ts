import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { randomBytes } from "node:crypto";
import type { Env } from "../config/env.schema";
import { InventoryModule } from "../inventory";
import { OrdersModule } from "../orders";
import { PaymentNumbersModule, PaymentsModule } from "../payments";
import { ShippingModule } from "../shipping";
import { StorageModule } from "../storage";
import { AdminAuthController } from "./auth/admin-auth.controller";
import { AdminAuthService } from "./auth/admin-auth.service";
import { AdminJwtGuard } from "./auth/admin-jwt.guard";
import { AdminRolesGuard } from "./auth/admin-roles.guard";
import { AdminBooksController, AdminBooksService, AdminUploadsController } from "./catalog";
import { AdminDashboardController, AdminDashboardService } from "./dashboard";
import { AdminOrdersController, AdminOrdersService } from "./orders";
import { AdminSettingsController, AdminSettingsService } from "./settings";

/**
 * Everything behind a credential.
 *
 * ## Guard registration
 *
 * Both guards are APP_GUARDs — global — rather than `@UseGuards` on each admin
 * controller, and the `@Public()` decorator is what opts login and refresh out.
 * The reasoning matches the global validation pipe and the global throttler in
 * CommonModule: a protection that must be remembered on every new route is a
 * protection that will eventually be forgotten, and forgetting this one means
 * publishing an endpoint that edits prices.
 *
 * Being global means they run for storefront routes too, which is exactly why
 * AdminJwtGuard checks the route's path prefix before doing anything — see
 * below. The alternative, registering them module-locally, was tried and
 * rejected: Nest resolves module-scoped APP_GUARDs globally anyway, so it
 * would have read as scoped while behaving as global, which is worse than
 * being plainly global.
 *
 * Order matters and is the registration order: AdminJwtGuard attaches
 * `request.admin`, AdminRolesGuard reads it.
 */
@Module({
  imports: [
    /**
     * Admin depends on the domain modules; none of them depends on admin. That
     * is why AdminModule is last in app.module.ts, and why the panel's order
     * routes call OrdersService and PaymentsService rather than reaching into
     * the tables those modules own.
     */
    OrdersModule,
    PaymentsModule,
    PaymentNumbersModule,
    ShippingModule,
    InventoryModule,
    StorageModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        /**
         * A random per-boot key when none is configured, which is only
         * reachable outside production — `validateEnv` refuses to start a
         * production process without ADMIN_JWT_SECRET.
         *
         * Random rather than a hardcoded development default, because a
         * hardcoded default is a real signing key that works, gets committed
         * to a `.env.example`, and eventually signs a token somewhere it
         * matters. This one makes the failure mode "you are signed out after a
         * restart", which is annoying in development and impossible to ship.
         */
        secret:
          config.get("ADMIN_JWT_SECRET", { infer: true }) ?? randomBytes(32).toString("base64"),
        signOptions: {
          algorithm: "HS256",
          issuer: "sakura-api",
          audience: "sakura-admin",
        },
        verifyOptions: {
          /**
           * Pinned. Without an explicit algorithm list, a verifier accepts
           * whatever the token's own header claims — the `alg: none` and
           * RS256→HS256 confusion attacks both live in that gap, and both let
           * an attacker sign their own tokens. The library defends against
           * some of this; saying it here means we do not depend on which
           * version is installed.
           */
          algorithms: ["HS256"],
          issuer: "sakura-api",
          audience: "sakura-admin",
        },
      }),
    }),
  ],
  controllers: [
    AdminAuthController,
    AdminOrdersController,
    AdminSettingsController,
    AdminDashboardController,
    AdminBooksController,
    AdminUploadsController,
  ],
  providers: [
    AdminAuthService,
    AdminOrdersService,
    AdminSettingsService,
    AdminDashboardService,
    AdminBooksService,
    { provide: APP_GUARD, useClass: AdminJwtGuard },
    { provide: APP_GUARD, useClass: AdminRolesGuard },
  ],
  // Exported for the admin feature modules that follow — orders, catalog,
  // coupons — every one of which needs the audit writer and the claims type.
  exports: [AdminAuthService],
})
export class AdminModule {}
