import type { OrderStatus } from "@sakura/contracts";

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
