import { Injectable } from "@nestjs/common";
import type { ShippingConfig } from "../config/shipping.config";

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

/**
 * ## Why this has no dependencies
 *
 * It used to hold the shipping config, injected at boot from the environment.
 * That was fine while the numbers could only change with a deploy, and wrong
 * the moment they became editable in the panel: a value injected once into a
 * singleton is a value that keeps pricing carts at whatever it was when the
 * process started.
 *
 * The fix is not to give this class a database — it is to stop it holding
 * state at all. `quote` now takes the terms alongside the numbers it was
 * already taking, so it is a pure function of its arguments, resolvable in a
 * test with a literal and incapable of going stale. Fetching the terms is the
 * caller's job, and the caller is already doing a database round-trip to
 * resolve the region.
 */
@Injectable()
export class ShippingPolicy {
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
  quote(
    subtotalCents: number,
    lineCount: number,
    terms: ShippingConfig,
    regionRateCents?: number | null,
  ): DeliveryQuote {
    const baseCents = lineCount === 0 ? 0 : (regionRateCents ?? terms.flatRateCents);
    const waived = subtotalCents >= terms.freeDeliveryThresholdCents;

    return {
      baseCents,
      chargedCents: waived ? 0 : baseCents,
      creditCents: waived ? baseCents : 0,
    };
  }
}
