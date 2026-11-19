import type { OrderStatus } from "@sakura/contracts";

/**
 * The pure rules of the cash-on-delivery approval flow (docs/cod-orders.md
 * Step 1). Kept out of the services so they are tested without a database.
 */

/**
 * Why the generic transition endpoint refuses this move, or null if it may go
 * ahead.
 *
 * A COD order leaves PENDING through AdminCodService only: approving records
 * how the customer got in touch, denying records a staff-only reason. The
 * generic endpoint would do neither — and it reaches PAYMENT_CONFIRMED by an
 * `advance` walk just as surely as by asking for it, so the route is checked,
 * not only the destination.
 *
 * Prepaid orders, and COD orders already past PENDING, are untouched.
 */
export function codPendingTransitionBlocker(
  paymentMethod: string,
  from: OrderStatus,
  entering: readonly OrderStatus[],
): string | null {
  if (paymentMethod !== "cash-on-delivery" || from !== "PENDING") return null;

  if (entering.includes("PAYMENT_CONFIRMED")) {
    return "Approve cash-on-delivery orders with Approve, which records how the customer confirmed.";
  }

  if (entering.includes("CANCELLED")) {
    return "Turn down cash-on-delivery orders with Deny, which records why.";
  }

  return null;
}

/**
 * The text a customer gets when their COD order is approved.
 *
 * Bangla, and one SMS segment: any Bangla character makes the message UCS-2,
 * which is 70 characters for the whole text. The test pins the length for the
 * longest order number the shop issues, so a reworded template that would
 * double the cost of every approval fails there rather than on the bill.
 */
export function codApprovedSms(orderNumber: string): string {
  return `অর্ডার ${orderNumber} নিশ্চিত হয়েছে। শীঘ্রই পাঠানো হবে। -Nihonova`;
}

/** The note on the status history, which the customer's tracking page shows. */
export const COD_APPROVED_NOTE = "Order confirmed";

/**
 * Also customer-visible, so deliberately says nothing about why. The reason
 * staff typed goes to the audit log only.
 */
export const COD_DENIED_NOTE = "Order could not be confirmed";
