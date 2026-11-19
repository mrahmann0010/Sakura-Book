import type { Order, OrderStatus } from "@sakura/contracts";
import type { TFunction } from "i18next";

import type { OrderProgressStep } from "@/components/domain";

/* --------------------------------------------------------------------------
   The one mapping from the API's 7-value OrderStatus onto the stages a
   customer is shown.

   Its own module rather than an export from either component that uses it:
   the detail card renders the receipt's summary lines, and the receipt renders
   the progress bar, so whichever of the two had owned this would have been
   imported by the other and closed a cycle.
   -------------------------------------------------------------------------- */

/**
 * The forward stage a status sits at, or null for the two that leave the
 * track entirely — cancelled and refunded are a StatusPill, not a fifth dot.
 */
export function toOrderProgressStep(status: OrderStatus): OrderProgressStep | null {
  switch (status) {
    case "PENDING":
      return "placed";
    case "PAYMENT_CONFIRMED":
      return "verified";
    /* Its own stage, not folded into `verified` as it used to be: the bar
       otherwise looked identical the moment the money cleared and the moment
       the parcel was boxed, and "is it packed yet" is the question people
       reopen the tracking page to ask. */
    case "PROCESSING":
      return "packed";
    case "SHIPPED":
    case "DELIVERED":
      return "shipped";
    case "CANCELLED":
    case "REFUNDED":
      return null;
  }
}

/* --------------------------------------------------------------------------
   Cash on delivery reads differently in two places.

   For a transfer, the second stage is "payment verified" — the shop checked
   the money. For cash on delivery no money moves until the courier arrives;
   that stage is the shop accepting the order after the customer confirmed it.
   Saying "payment verified" there would tell the customer they had paid.
   -------------------------------------------------------------------------- */

/** Stage labels that differ for cash on delivery, for `OrderProgress`. */
export function progressLabelsFor(
  order: Order,
  t: TFunction,
): Partial<Record<OrderProgressStep, string>> | undefined {
  if (order.paymentMethod !== "cash-on-delivery") return undefined;

  return { verified: t("orders.progress.confirmed") };
}

/** The tracking page's one-sentence status, with COD's own wording where it differs. */
export function headlineKeyFor(order: Order): string {
  if (
    order.paymentMethod === "cash-on-delivery" &&
    (order.status === "PENDING" || order.status === "PAYMENT_CONFIRMED")
  ) {
    return `orders.headlineCod.${order.status}`;
  }

  return `orders.headline.${order.status}`;
}
