import { ConfigService } from "@nestjs/config";
import type { Env } from "./env.schema";

/**
 * Shop policy that used to live in the browser bundle.
 *
 * `FREE_DELIVERY_THRESHOLD` and `DELIVERY_FLAT` are currently constants in
 * apps/web/src/lib/cart.ts — i.e. numbers a customer can edit in devtools and
 * then send to us. They move here, and the frontend's copies become
 * presentation-only defaults that the /cart/quote response overrides.
 *
 * Read from env rather than hardcoded because the threshold is a marketing
 * lever: "free delivery over X" changes for a campaign, and that must not be
 * a code deploy.
 */
export type ShippingConfig = {
  /** ISO 4217. Every amount the API emits is minor units of this. */
  readonly currency: string;
  /** Flat postage charged when the threshold is not met, in minor units. */
  readonly flatRateCents: number;
  /** Subtotal at or above which postage is waived, in minor units. */
  readonly freeDeliveryThresholdCents: number;
};

/**
 * Injection token. A plain value provider rather than a service, because there
 * is no behaviour here — the behaviour is ShippingPolicy, which takes this as
 * a dependency and is therefore trivially testable with a literal.
 */
export const SHIPPING_CONFIG = Symbol("SHIPPING_CONFIG");

export function shippingConfigFrom(config: ConfigService<Env, true>): ShippingConfig {
  return Object.freeze({
    currency: config.get("CURRENCY", { infer: true }),
    flatRateCents: config.get("DELIVERY_FLAT_CENTS", { infer: true }),
    freeDeliveryThresholdCents: config.get("FREE_DELIVERY_THRESHOLD_CENTS", { infer: true }),
  });
}
