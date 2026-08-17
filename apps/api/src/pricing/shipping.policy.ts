import { Inject, Injectable } from "@nestjs/common";
import { SHIPPING_CONFIG, type ShippingConfig } from "../config/shipping.config";

/**
 * What postage costs, and when it is waived.
 *
 * The shape mirrors `CartTotals` in apps/web/src/lib/cart.ts on purpose: the
 * summary rail draws three separate rows — what postage would have cost, what
 * is actually charged, and the waived amount as a credit line — so returning
 * only the charged figure would force the client to re-derive the other two
 * from the threshold, which is exactly the duplication this move exists to
 * remove.
 */
export type DeliveryQuote = {
  /** Postage before any waiver. Zero for an empty cart. */
  baseCents: number;
  /** Postage actually added to the total. */
  chargedCents: number;
  /** The amount waived, shown as a credit row. Zero when nothing is waived. */
  creditCents: number;
};

@Injectable()
export class ShippingPolicy {
  constructor(@Inject(SHIPPING_CONFIG) private readonly config: ShippingConfig) {}

  /**
   * `lineCount` rather than a subtotal test for emptiness: a cart could in
   * principle total zero (a fully-discounted line) and still be a real order
   * that needs posting. Only "no lines at all" means no postage.
   */
  quote(subtotalCents: number, lineCount: number): DeliveryQuote {
    const baseCents = lineCount === 0 ? 0 : this.config.flatRateCents;
    const waived = subtotalCents >= this.config.freeDeliveryThresholdCents;

    return {
      baseCents,
      chargedCents: waived ? 0 : baseCents,
      creditCents: waived ? baseCents : 0,
    };
  }

  /**
   * Exposed so /cart/quote and /shipping/regions can tell the client the rule
   * it is being priced under — "spend 4.50 more for free delivery" is a
   * frontend string, but the numbers behind it are shop policy and must come
   * from here rather than from a constant in the bundle.
   */
  get terms(): ShippingConfig {
    return this.config;
  }
}
