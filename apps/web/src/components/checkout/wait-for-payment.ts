import type { Order } from "@sakura/contracts";

/* --------------------------------------------------------------------------
   What the "payment is being checked" modal settles on.

   The customer pays before pressing "Place order", so the payment SMS can
   reach the gateway a moment after the order does. The server claims the
   payment once inside the checkout request and does not retry: a receipt it
   could not see yet waits for staff to press "Check & confirm". That makes
   the status on the checkout response final, so there is nothing to wait for
   here — a PENDING order cannot turn into PAYMENT_CONFIRMED while the modal
   is open.

   This used to re-read the order every 3s for a minute, which is what the
   background retry worker needed. With that worker off (see
   ClaimRetryWorker), the poll could only return the same PENDING answer
   twenty times before showing "we'll confirm it shortly" anyway, so the
   shopper now gets that answer at once. Restoring the worker means restoring
   the poll: re-read with `getOrderPaymentStatus` until the status moves.
   -------------------------------------------------------------------------- */

/**
 * The order the modal should resolve on. Kept as a seam so the checkout views
 * do not have to know whether a payment can still settle after the response.
 */
export async function waitForPayment(order: Order): Promise<Order> {
  return order;
}
