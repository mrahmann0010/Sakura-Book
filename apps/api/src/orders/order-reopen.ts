import type { OrderStatus } from "./order-status.machine";

/* --------------------------------------------------------------------------
   Reopening an order rejected by mistake.

   CANCELLED stays terminal in the machine, deliberately. `isTerminal` is what
   `releasesStock`, `releasesWaitlist` and `forwardPathTo` read, and an outgoing
   edge from CANCELLED would quietly change all three. Reopening is instead a
   separate, narrow door — `OrdersService.reopen` — and these are the rules for
   when it may be opened.

   The case it exists for: a manual-transfer order rejected at the desk because
   the TrxID looked wrong or the SMS had not arrived yet, and the money turns
   up an hour later. Without this the customer has to place the order again.
   -------------------------------------------------------------------------- */

/** How long after a rejection it may still be undone. */
export const REOPEN_WINDOW_DAYS = 7;

const REOPEN_WINDOW_MS = REOPEN_WINDOW_DAYS * 24 * 60 * 60 * 1000;

type HistoryRow = { status: OrderStatus; createdAt: Date };

/**
 * Why this order cannot be reopened, or null when it can.
 *
 * Only an order rejected **from PENDING** qualifies. One cancelled after
 * payment was confirmed has had its sale un-counted and possibly its money
 * discussed with the customer; putting it back is a different conversation.
 *
 * Only an order rejected **by staff** qualifies. A customer who cancelled
 * their own order meant it, and reopening it would reserve stock against
 * someone who no longer wants the book. `adminCancelledAt` is the time of the
 * admin audit entry recording the cancellation — the customer's own cancel
 * writes none.
 *
 * Stock and the TrxID are not checked here: both can change between this
 * answer and the click, so `OrdersService.reopen` checks them inside its
 * transaction instead.
 */
export function reopenBlocker(
  status: OrderStatus,
  history: readonly HistoryRow[],
  adminCancelledAt: Date | null,
  now: Date = new Date(),
): string | null {
  if (status !== "CANCELLED") return "Only a cancelled order can be reopened.";

  const sorted = [...history].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const cancelled = sorted.at(-1);
  const before = sorted.at(-2);

  if (!cancelled || cancelled.status !== "CANCELLED") {
    return "This order's history does not end in a cancellation.";
  }

  if (before?.status !== "PENDING") {
    return "Only an order rejected while still pending can be reopened.";
  }

  /* The audit entry is written just after the cancellation commits, so it is
     never earlier than the history row. One from before it belongs to an
     earlier cancellation that was since reopened, and says nothing about who
     cancelled this time. */
  if (!adminCancelledAt || adminCancelledAt.getTime() < cancelled.createdAt.getTime()) {
    return "The customer cancelled this order themselves.";
  }

  if (now.getTime() - cancelled.createdAt.getTime() > REOPEN_WINDOW_MS) {
    return `Orders can only be reopened within ${REOPEN_WINDOW_DAYS} days of being rejected.`;
  }

  return null;
}
