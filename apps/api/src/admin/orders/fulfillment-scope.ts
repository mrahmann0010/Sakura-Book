import {
  FULFILLMENT_SHIPPED_WINDOW_DAYS,
  FULFILLMENT_TRANSITION_TARGETS,
  type AdminOrderDetail,
  type AdminOrderSummary,
  type AdminRole,
  type OrderStatus,
} from "@sakura/contracts";
import { and, eq, gte, inArray, or, sql, type SQL } from "drizzle-orm";
import { orderStatusHistory, orders } from "../../db/schema";

/**
 * The packing table's view of the orders desk.
 *
 * The guard decides which *routes* a FULFILLMENT account may call; this file
 * decides which *orders* it may see through them, which fields of those orders,
 * and which moves it may make. Kept apart from the service so the whole of the
 * packer's scope is one file a reviewer can read top to bottom, and so every
 * rule here is a pure function the unit tests can pin without a database.
 *
 * Everything is keyed off the caller's role and nothing else. There is no
 * "packer mode" flag in a request, because anything a request can switch off
 * is not a restriction.
 */

export function isFulfillment(role: AdminRole): boolean {
  return role === "FULFILLMENT";
}

/** Before this instant, a SHIPPED order has left the packer's view. */
function shippedCutoff(now: Date): Date {
  return new Date(now.getTime() - FULFILLMENT_SHIPPED_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * The orders a packer may see, as a WHERE clause ANDed onto whatever the
 * caller filtered by.
 *
 * ANDed rather than substituted, so the packer's own tabs and search still
 * work — and so a packer who asks for `?status=PENDING` gets an empty page
 * rather than an error that confirms pending orders exist to be asked about.
 *
 * The SHIPPED window is read off `order_status_history`, not `updated_at`: a
 * note edited on a month-old order touches the row, and must not bring a
 * customer's address back into view.
 */
export function fulfillmentOrderScope(now: Date = new Date()): SQL {
  return or(
    inArray(orders.status, ["PAYMENT_CONFIRMED", "PROCESSING"]),
    and(
      eq(orders.status, "SHIPPED"),
      sql`exists (select 1 from ${orderStatusHistory} where ${and(
        eq(orderStatusHistory.orderId, orders.id),
        eq(orderStatusHistory.status, "SHIPPED"),
        gte(orderStatusHistory.createdAt, shippedCutoff(now)),
      )})`,
    ),
  )!;
}

/**
 * The same rule as `fulfillmentOrderScope`, for one order already in memory.
 *
 * Two readings of one rule is normally the thing to avoid; here the SQL form
 * filters a page nobody has loaded yet and this one judges a row somebody
 * asked for by number, and the tests hold both to the same cases.
 */
export function isInFulfillmentScope(
  row: { status: OrderStatus; statusHistory: readonly { status: string; createdAt: Date }[] },
  now: Date = new Date(),
): boolean {
  if (row.status === "PAYMENT_CONFIRMED" || row.status === "PROCESSING") return true;
  if (row.status !== "SHIPPED") return false;

  const cutoff = shippedCutoff(now);

  return row.statusHistory.some(
    (entry) => entry.status === "SHIPPED" && entry.createdAt.getTime() >= cutoff.getTime(),
  );
}

/**
 * Why a packer may not make this move, or null if they may.
 *
 * `entering` is every status the request would put the order into — the whole
 * route for an `advance`, as the service computes it — so marking a
 * PAYMENT_CONFIRMED order shipped (through PROCESSING) is allowed, while
 * anything that passes through a status outside the packer's two is not.
 *
 * A duplicate-receipt override is refused outright. It is only meaningful on
 * the way into PAYMENT_CONFIRMED, which a packer can never enter, so its
 * presence means a request built for some other screen.
 */
export function fulfillmentTransitionBlocker(
  from: OrderStatus,
  entering: readonly OrderStatus[],
  duplicateReceiptOverride: string | undefined,
): string | null {
  if (from !== "PAYMENT_CONFIRMED" && from !== "PROCESSING") {
    return "Only orders waiting to be packed or being packed can be moved from the packing table.";
  }

  const allowed: readonly OrderStatus[] = FULFILLMENT_TRANSITION_TARGETS;

  if (entering.length === 0 || entering.some((status) => !allowed.includes(status))) {
    return "From the packing table an order can only be marked packing or shipped. Leave a note for anything else.";
  }

  if (duplicateReceiptOverride) {
    return "Payment decisions are not made from the packing table.";
  }

  return null;
}

/**
 * A queue row with the payment side taken out.
 *
 * Blanked rather than removed, so the wire shape stays the one contract the
 * panel already renders, and the neutral values chosen are the ones that draw
 * no badge: NOT_APPLICABLE for the receipt and UNCHECKED-with-no-date for the
 * gateway check. What stays is what a parcel needs, including `totalCents`,
 * because on a cash-on-delivery order that is the amount the courier collects
 * and has to be written on the label.
 *
 * The email goes too: nothing about packing or handing over a parcel uses it,
 * and it is the one contact detail a packer could not otherwise see on the
 * box.
 */
export function redactSummaryForFulfillment(summary: AdminOrderSummary): AdminOrderSummary {
  return {
    ...summary,
    customerEmail: "",
    paymentProvider: null,
    receipt: NEUTRAL_RECEIPT,
    verification: NEUTRAL_VERIFICATION,
  };
}

/**
 * The detail page, with the payment side taken out and the controls narrowed.
 *
 * `allowedTransitions` is cut down to the packer's forward moves as well as
 * being enforced on the way in, so the panel — which draws its buttons from
 * this list — offers only what the server will accept rather than buttons
 * that 403.
 */
export function redactDetailForFulfillment(detail: AdminOrderDetail): AdminOrderDetail {
  const allowed: readonly OrderStatus[] = FULFILLMENT_TRANSITION_TARGETS;

  return {
    ...detail,
    customerEmail: "",
    paymentProvider: null,
    paymentSenderNumber: null,
    senderNumber: null,
    transactionId: null,
    payments: [],
    allowedTransitions: detail.allowedTransitions.filter((status) => allowed.includes(status)),
    reopen: { allowed: false, blockedReason: null },
    receipt: NEUTRAL_RECEIPT,
    verification: NEUTRAL_VERIFICATION,
    verifications: [],
  };
}

const NEUTRAL_RECEIPT: AdminOrderSummary["receipt"] = {
  state: "NOT_APPLICABLE",
  claimedByOrderNumber: null,
};

const NEUTRAL_VERIFICATION: AdminOrderSummary["verification"] = {
  outcome: "UNCHECKED",
  checkedAt: null,
  checkedByEmail: null,
};
