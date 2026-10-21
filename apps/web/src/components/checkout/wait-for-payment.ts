import type { Order } from "@sakura/contracts";

import { getOrderPaymentStatus } from "@/lib/api/orders";

/* --------------------------------------------------------------------------
   Keeping the "payment is being checked" modal open while the payment lands.

   The customer pays before pressing "Place order", but the payment SMS often
   reaches the gateway a few seconds after the order does. The server claims
   once inside the request and then keeps retrying in the background, so a
   PENDING answer here usually turns into PAYMENT_CONFIRMED within a minute.
   This re-reads the order until it does, or until it is time to stop waiting
   and say "we'll confirm it shortly".
   -------------------------------------------------------------------------- */

/** How long the modal waits before showing "not yet". */
const WAIT_MS = 60_000;

/** Between re-reads. Inside the endpoint's 30-a-minute limit with room to spare. */
const POLL_MS = 3_000;

/**
 * Resolves with the order as soon as its payment is no longer pending, or
 * with the latest copy once the wait is over. Never rejects: a failed
 * re-read is retried on the next tick, and the order exists either way.
 */
export async function waitForPayment(order: Order, email: string): Promise<Order> {
  if (order.paymentMethod !== "manual-transfer" || order.status !== "PENDING") return order;

  const deadline = Date.now() + WAIT_MS;
  let latest = order;

  while (Date.now() + POLL_MS <= deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));

    try {
      latest = await getOrderPaymentStatus({ orderNumber: order.orderNumber, email });
    } catch {
      // A dropped request or a rate limit says nothing about the payment.
      continue;
    }

    if (latest.status !== "PENDING") return latest;
  }

  return latest;
}
