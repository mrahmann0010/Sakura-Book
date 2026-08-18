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
   * `regionRateCents` is the selected region's override, or null/undefined for
   * the flat national rate — which is every region today. It is a parameter
   * rather than a lookup inside this class because the policy must stay a pure
   * function of numbers: it is the piece the unit tests pin the money rules to,
   * and giving it a database dependency would mean the ladder could only be
   * tested against a live table.
   *
   * The waiver is applied to the region rate too. A shop that charges more to
   * post outside Dhaka still means "free delivery over ৳1,500" when it says so,
   * and a threshold that silently only waived the cheap rate would be the kind
   * of surprise a customer discovers at the last checkout step.
   *
   * `lineCount` rather than a subtotal test for emptiness: a cart could in
   * principle total zero (a fully-discounted line) and still be a real order
   * that needs posting. Only "no lines at all" means no postage.
   */
  quote(subtotalCents: number, lineCount: number, regionRateCents?: number | null): DeliveryQuote {
    const baseCents = lineCount === 0 ? 0 : (regionRateCents ?? this.config.flatRateCents);
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
