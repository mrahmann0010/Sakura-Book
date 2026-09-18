import type { OrderStatus } from "@sakura/contracts";

/* --------------------------------------------------------------------------
   The order pipeline, as the shop works it.

   One definition of "what stage is this order at", read by the dashboard's
   queue, by the Orders screen's tabs, and by anything else that needs to group
   the seven statuses into the four jobs a person actually sits down to do.

   ## Why this exists

   The lifecycle was being described in three places that had to agree by hand:
   the state machine in the API, the dashboard's own status→label map, and two
   separate `TABS` arrays on two order screens. They did agree — but only
   because somebody kept them in step, and the comments on both screens carry
   the strain of explaining why the word "Accepted" covered four statuses in
   one place and two in another.

   The cost showed up as a missing link. The dashboard names five buckets and
   could only send you to three tabs, because no tab corresponded to a bucket;
   its own comment admits "a bucket cannot link to itself precisely". With one
   table, a bucket and a tab are the same object and the link is exact.

   ## Why it is not in @sakura/contracts

   Nothing here crosses the wire. The list endpoint filters by `status[]` and
   the dashboard reports counts per status — neither has any notion of a stage,
   and neither should, because which statuses a shop chooses to work in one
   sitting is a fact about the shop's desk rather than about its data. That
   makes this a view model, which the contracts package's own header rules out.

   ## Why stage membership is total

   `STATUS_STAGE` is a total Record over OrderStatus rather than a partial one,
   for the same reason ORDER_STATUS_TRANSITIONS is: adding a status to the enum
   should be a type error here until somebody says which stage it is worked at,
   instead of silently vanishing from every queue in the panel.
   -------------------------------------------------------------------------- */

/** The stages, in the order the work happens. */
export const ORDER_STAGE_KEYS = ["verify", "dispatch", "transit", "closed"] as const;

export type OrderStageKey = (typeof ORDER_STAGE_KEYS)[number];

/**
 * A tick that moves a batch of orders one step along.
 *
 * `from` is not decoration. A stage can hold more than one status, and a bulk
 * action rarely applies to all of them — "Mark packed" means nothing to an
 * order that is already being packed. Listing the statuses it applies to lets
 * a screen offer the action against the rows it can actually move, and leave
 * the others untouched rather than sending a request the API will refuse.
 *
 * These lists mirror ORDER_STATUS_TRANSITIONS in the API, which stays the
 * authority — the transition endpoint rejects anything the machine forbids, so
 * a mistake here is a control that fails loudly, not a corrupt order.
 */
export type OrderStageAction = {
  /** The verb on the button, in the operator's words rather than the enum's. */
  label: string;
  to: OrderStatus;
  from: readonly OrderStatus[];
};

export type OrderStage = {
  key: OrderStageKey;
  /** The tab label, and the heading once a tab is open. */
  label: string;
  /** One line under the heading saying what this list is for. */
  hint: string;
  statuses: readonly OrderStatus[];
  /**
   * Bulk ticks this stage offers, in the order they appear. Empty where a
   * batch decision would be the wrong shape — see `verify` below.
   */
  actions: readonly OrderStageAction[];
  /**
   * Which date a range filter on this tab filters, and the word it is labelled
   * with. The two differ per stage because the tabs ask about different days:
   * a dispatch list asks when an order came in, an in-transit list asks when
   * the parcel went out. Filtering the latter by placed date would put an
   * order placed on the 1st and shipped on the 9th under the 1st, on a list
   * about dispatch.
   */
  dateField: "placed" | "shipped";
  dateNoun: string;
};

export const ORDER_STAGES: readonly OrderStage[] = Object.freeze([
  {
    key: "verify",
    label: "To verify",
    hint: "Payment claimed, not yet checked",
    statuses: ["PENDING"],
    /*
     * Deliberately no bulk action.
     *
     * Every other stage moves parcels, which are interchangeable; this one
     * judges receipts, which are not. Accepting a screenful of orders in one
     * tick is precisely the mistake that DUPLICATE_RECEIPT_OVERRIDE and
     * PAYMENT_REVERT exist to clean up after, and a control that makes it easy
     * to make twenty at once is not a convenience.
     */
    actions: [],
    dateField: "placed",
    dateNoun: "Placed",
  },
  {
    key: "dispatch",
    label: "To dispatch",
    hint: "Paid, not yet handed to the courier",
    /*
     * Two statuses, one desk. Picking and handing over are one physical
     * session for a shop this size, so splitting them into two tabs would
     * charge two ticks for what is usually one motion — and that is the reason
     * PROCESSING is currently skipped in practice: it has never had a control
     * of its own, only a line on the dashboard reporting how many orders are
     * sitting in a state nothing helps you leave.
     *
     * Keeping both here makes the intermediate state optional rather than
     * unsupported. A shop that packs in the morning and ships in the afternoon
     * ticks Mark packed and sees the split; one that does both at once ticks
     * Mark shipped and never thinks about PROCESSING at all.
     */
    statuses: ["PAYMENT_CONFIRMED", "PROCESSING"],
    actions: [
      { label: "Mark packed", to: "PROCESSING", from: ["PAYMENT_CONFIRMED"] },
      { label: "Mark shipped", to: "SHIPPED", from: ["PAYMENT_CONFIRMED", "PROCESSING"] },
    ],
    dateField: "placed",
    dateNoun: "Placed",
  },
  {
    key: "transit",
    label: "In transit",
    hint: "With the courier, not yet delivered",
    statuses: ["SHIPPED"],
    /*
     * The tick this panel has never had.
     *
     * Marking an order delivered was a one-at-a-time trip through the detail
     * page, which is why the old dispatch screen's Shipped tab claimed
     * "nothing there has a next step that a checkbox could honestly stand
     * for" — but the machine says SHIPPED → DELIVERED, so there plainly is
     * one. It matters beyond tidiness: the Revenue screen's headline splits
     * money in hand from money still with a courier, and that split is only as
     * accurate as the least convenient transition in the panel.
     */
    actions: [{ label: "Mark delivered", to: "DELIVERED", from: ["SHIPPED"] }],
    dateField: "shipped",
    dateNoun: "Shipped",
  },
  {
    key: "closed",
    label: "Closed",
    hint: "Delivered, cancelled or refunded",
    /*
     * Outcomes rather than work, which is why they share a tab. The three
     * differ enormously in meaning and not at all in what is left to do, and
     * this is the tab somebody opens knowing the order number — so it is a
     * searchable archive, not a queue.
     *
     * Reopening a cancelled order and refunding a delivered one both stay on
     * the detail page: they need a written reason, and a reason is not
     * something a row in a list can ask for.
     */
    statuses: ["DELIVERED", "CANCELLED", "REFUNDED"],
    actions: [],
    dateField: "placed",
    dateNoun: "Placed",
  },
] satisfies readonly OrderStage[]);

/**
 * Which stage each status is worked at.
 *
 * The inverse of `ORDER_STAGES[].statuses`, written out rather than derived so
 * that it is total over OrderStatus — a derived map would be a lookup that
 * returns undefined for a status nobody assigned, which is the silent failure
 * this is meant to prevent. `assertStagesCoverEveryStatus` below keeps the two
 * honest about each other.
 */
export const STATUS_STAGE: Readonly<Record<OrderStatus, OrderStageKey>> = Object.freeze({
  PENDING: "verify",
  PAYMENT_CONFIRMED: "dispatch",
  PROCESSING: "dispatch",
  SHIPPED: "transit",
  DELIVERED: "closed",
  CANCELLED: "closed",
  REFUNDED: "closed",
} satisfies Record<OrderStatus, OrderStageKey>);

/**
 * What is true of the parcel, per status, for a reader who is about to go and
 * do something about it.
 *
 * Moved off the dashboard so the pipeline's tabs and the dashboard's queue
 * describe the same seven states in the same words. `urgentAfterHours` is the
 * age at which the oldest order in a bucket stops being a queue and starts
 * being a problem: payment chases are the impatient one, because an unpaid
 * order is a held reservation and a customer who has probably forgotten. The
 * closed statuses have no threshold at all — nothing is waiting.
 */
export const ORDER_STATUS_META: Readonly<
  Record<OrderStatus, { label: string; hint: string; urgentAfterHours: number | null }>
> = Object.freeze({
  PENDING: {
    label: "Waiting for payment",
    hint: "Not yet paid or verified",
    urgentAfterHours: 24,
  },
  PAYMENT_CONFIRMED: {
    label: "Paid, not yet packed",
    hint: "Ready to pick",
    urgentAfterHours: 24,
  },
  PROCESSING: {
    label: "Being packed",
    hint: "Picked, not yet handed over",
    urgentAfterHours: 48,
  },
  SHIPPED: {
    label: "With the courier",
    hint: "Out for delivery",
    urgentAfterHours: 168,
  },
  DELIVERED: { label: "Delivered", hint: "Closed", urgentAfterHours: null },
  CANCELLED: { label: "Cancelled", hint: "Closed", urgentAfterHours: null },
  REFUNDED: { label: "Refunded", hint: "Closed", urgentAfterHours: null },
});

export function stageByKey(key: OrderStageKey): OrderStage {
  /* Non-null: ORDER_STAGE_KEYS and ORDER_STAGES are declared together, and the
     assertion below fails the test suite if one ever loses an entry. */
  return ORDER_STAGES.find((stage) => stage.key === key)!;
}

/** The stage a status is worked at — the exact tab a dashboard bucket links to. */
export function stageForStatus(status: OrderStatus): OrderStage {
  return stageByKey(STATUS_STAGE[status]);
}

/**
 * Which of `statuses` this action can actually move.
 *
 * Screens use it to decide whether to offer a bulk control at all, and to send
 * only the rows it applies to — ticking ten orders where three are already
 * packed should pack the seven and leave the three alone, not fail the batch.
 */
export function actionApplies(action: OrderStageAction, status: OrderStatus): boolean {
  return action.from.includes(status);
}

/**
 * Every status is in exactly one stage, and every stage's statuses agree with
 * STATUS_STAGE.
 *
 * The `satisfies` clauses above already catch the likeliest mistake — adding a
 * status to the enum without giving it a stage is a type error. This covers
 * what types cannot: a status listed under two stages, or a stage whose
 * `statuses` disagree with STATUS_STAGE, both of which are well-typed and
 * still wrong.
 *
 * Run below on import in development only. It belongs in a unit test, but
 * `apps/web` has no test runner yet (only the API does), and the choice was
 * between this and no check at all. Guarded from production because a module
 * that throws on load takes the panel down, and a structural mistake that
 * reaches production is better as one odd-looking tab than as a blank screen.
 */
export function assertStagesCoverEveryStatus(): void {
  const seen = new Map<OrderStatus, OrderStageKey>();

  for (const stage of ORDER_STAGES) {
    for (const status of stage.statuses) {
      const already = seen.get(status);
      if (already) {
        throw new Error(`${status} is in two stages: ${already} and ${stage.key}`);
      }
      seen.set(status, stage.key);

      if (STATUS_STAGE[status] !== stage.key) {
        throw new Error(
          `${status} is listed under stage ${stage.key} but STATUS_STAGE says ${STATUS_STAGE[status]}`,
        );
      }
    }
  }

  for (const status of Object.keys(STATUS_STAGE) as OrderStatus[]) {
    if (!seen.has(status)) {
      throw new Error(`${status} belongs to no stage`);
    }
  }
}

if (process.env.NODE_ENV !== "production") {
  assertStagesCoverEveryStatus();
}
