import { Logger, type Provider } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createGatewayClient, type GatewayClient } from "@project-sakura/pay";
import type { Env } from "../config/env.schema";

/** Injection token for the shared @project-sakura/pay client. */
export const PAYMENT_GATEWAY = Symbol("PAYMENT_GATEWAY");

/**
 * The payment gateway client, built once from SAKURA_PAYMENT_GATEWAY_*.
 *
 * Everything about the gateway itself lives in @project-sakura/pay. This only
 * hands it our config. The env schema has already enforced all-three-or-none
 * (and all three in production); with none set, `enabled` is false and every
 * claim is UNAVAILABLE, so orders wait for a person rather than being
 * assumed paid.
 */
export const paymentGatewayProvider: Provider = {
  provide: PAYMENT_GATEWAY,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>): GatewayClient =>
    createGatewayClient({
      baseUrl: config.get("SAKURA_PAYMENT_GATEWAY_URL", { infer: true }),
      clientId: config.get("SAKURA_PAYMENT_GATEWAY_CLIENT_ID", { infer: true }),
      secret: config.get("SAKURA_PAYMENT_GATEWAY_SECRET", { infer: true }),
      timeoutMs: config.get("SAKURA_PAYMENT_GATEWAY_TIMEOUT_MS", { infer: true }),
      logger: new Logger("PaymentGateway"),
    }),
};
