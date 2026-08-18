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
