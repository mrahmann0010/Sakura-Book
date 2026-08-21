import { pgEnum } from "drizzle-orm/pg-core";

export const bookAuthorRoleEnum = pgEnum("book_author_role", [
  "AUTHOR",
  "CO_AUTHOR",
  "ILLUSTRATOR",
  "TRANSLATOR",
  "EDITOR",
]);

export const couponDiscountTypeEnum = pgEnum("coupon_discount_type", [
  "PERCENTAGE", // discountValue is 1-100, a percentage of subtotal
  "FIXED_AMOUNT", // discountValue is an amount in cents
]);

export const orderStatusEnum = pgEnum("order_status", [
  "PENDING",
  "PAYMENT_CONFIRMED",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
]);

/**
 * How the customer said they would pay, recorded on the order itself.
 *
 * `payments.provider` answers a different question — which integration
 * processed a given attempt — and cannot answer this one, because cash on
 * delivery has no provider row until the courier is paid.
 *
 * Lowercase and hyphenated, unlike the enums above, because these are not our
 * words: the values are `paymentMethods` in @sakura/contracts, which the
 * checkout form's radio group and the API's request schema both validate
 * against. Every enum in this file holds whatever its contract union holds, and
 * that is the rule being followed here — a SCREAMING_SNAKE variant would need a
 * translation table on both the write and the read path, and a translation
 * table is a thing that can drift.
 *
 * `card` is in the enum but not in `acceptedPaymentMethods`: the form draws it
 * disabled and the API refuses it (§2). Putting it here now means enabling it
 * later is a contract change, not a migration.
 */
export const paymentMethodEnum = pgEnum("payment_method", [
  "cash-on-delivery",
  "manual-transfer",
  "card",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "PENDING",
  "SUCCEEDED",
  "FAILED",
  "REFUNDED",
]);

/**
 * Staff roles. SCREAMING_SNAKE like the other internal enums — unlike
 * `payment_method`, these are our words, not a contract with a form control.
 * The values mirror `ADMIN_ROLES` in @sakura/contracts; see the comment there
 * for why there are two of them and not a permissions table.
 */
export const adminRoleEnum = pgEnum("admin_role", ["STAFF", "ADMIN"]);

/**
 * What an audited action did. Coarse on purpose: the *what* is already in the
 * before/after diff, so this column exists to make "show me every deletion" a
 * cheap indexed query rather than to re-describe the change.
 */
/**
 * A pre-order's two tracks, one column each.
 *
 * Split rather than a single `pre_order_status` because the two answer
 * different questions on wildly different clocks: payment verification happens
 * within a day of checkout, fulfilment cannot begin until the print run lands
 * months later. A single column has to pick one, and every value it holds
 * leaves the other question unanswerable — "CONFIRMED" says nothing about
 * whether a parcel exists, and "SHIPPED" says nothing about whether the bKash
 * transfer was ever verified.
 *
 * Neither is orderStatusEnum, and neither should be folded into it: an order
 * has one clock and one lifecycle, and reusing that enum here would mean
 * values (PAYMENT_CONFIRMED, PROCESSING) that are legal for a row but mean
 * something else in the other table.
 */
export const preOrderPaymentStatusEnum = pgEnum("pre_order_payment_status", [
  "PENDING",
  "ACCEPTED",
  "REJECTED",
  "REFUNDED",
]);

export const preOrderFulfillmentStatusEnum = pgEnum("pre_order_fulfillment_status", [
  "NOT_STARTED",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
]);

export const auditActionEnum = pgEnum("audit_action", [
  "CREATE",
  "UPDATE",
  "DELETE",
  "LOGIN",
  "LOGIN_FAILED",
  "LOGOUT",
  "TRANSITION",
  "ADJUST",
]);
