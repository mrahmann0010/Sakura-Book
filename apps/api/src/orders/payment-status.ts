import type { OrderPaymentStatus, PaymentMethod } from "@sakura/contracts";
import type { OrderStatus } from "./order-status.machine";

/**
 * What an order's payment status becomes when its order status moves.
 *
 * **Why this is derived from status changes at all.** This is the "expand"
 * step of separating money from fulfilment (docs/cod-orders.md §3.4). Today
 * every money event in this codebase *is* a status change — a verified
 * transfer is the move into PAYMENT_CONFIRMED, a refund is the move into
 * REFUNDED, a revert is PAYMENT_CONFIRMED → PENDING — so deriving the new
 * field from those moves keeps it exactly as correct as the old reading,
 * through the one write path every move already takes, without touching any
 * caller. When a money event appears that is *not* a status change (a courier
 * remittance, an advance paid on a COD order), it writes `payment_status`
 * directly and this rule is not involved.
 *
 * **The rules, and why each one is what it is:**
 *
 * - **Into REFUNDED → REFUNDED**, whatever the method. The money went back.
 * - **Out of PAYMENT_CONFIRMED back to PENDING → UNPAID.** That edge exists for
 *   one action, an admin undoing a confirmation made by mistake, and its
 *   meaning is "no money arrived after all".
 * - **Prepaid into PAYMENT_CONFIRMED → PAID.** For a transfer, that move is the
 *   moment staff (or the gateway) matched the money.
 * - **COD into PAYMENT_CONFIRMED → unchanged.** For cash on delivery the same
 *   move means "accepted for fulfilment" (see `CashOnDeliveryProvider`), and no
 *   money has changed hands. This is the case the old single field got wrong.
 * - **COD into DELIVERED → COLLECTED.** The courier handed the parcel over and
 *   took the cash. The shop does not have it yet — REMITTED is for that.
 * - **Anything else → unchanged.** In particular a prepaid order cancelled
 *   after it was paid stays PAID: the shop holds money for an order it will not
 *   send, which is a refund still owed, and saying UNPAID would hide it.
 *
 * Pure, so the whole table is unit-tested without a database, and the
 * migration's backfill states the same rules in SQL.
 */
export function nextPaymentStatus(input: {
  method: PaymentMethod;
  current: OrderPaymentStatus;
  from: OrderStatus;
  to: OrderStatus;
}): OrderPaymentStatus {
  const { method, current, from, to } = input;
  const cod = method === "cash-on-delivery";

  if (to === "REFUNDED") return "REFUNDED";
  if (from === "PAYMENT_CONFIRMED" && to === "PENDING") return "UNPAID";
  if (!cod && to === "PAYMENT_CONFIRMED") return "PAID";
  if (cod && to === "DELIVERED") return "COLLECTED";

  return current;
}
