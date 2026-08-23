import { ConfigService } from "@nestjs/config";
import type { Env } from "./env.schema";

/**
 * The mobile-money receiving numbers, before any database override.
 *
 * Mirrors ShippingConfig/shippingConfigFrom: a plain frozen value, injected
 * under a token, so PaymentNumbersService stays trivially testable with a
 * literal instead of a mocked ConfigService.
 */
export type PaymentNumbersConfig = {
  readonly bkashNumber: string;
  readonly rocketNumber: string;
  readonly nagadNumber: string;
};

export const PAYMENT_NUMBERS_CONFIG = Symbol("PAYMENT_NUMBERS_CONFIG");

export function paymentNumbersConfigFrom(config: ConfigService<Env, true>): PaymentNumbersConfig {
  return Object.freeze({
    bkashNumber: config.get("BKASH_NUMBER", { infer: true }),
    rocketNumber: config.get("ROCKET_NUMBER", { infer: true }),
    nagadNumber: config.get("NAGAD_NUMBER", { infer: true }),
  });
}
