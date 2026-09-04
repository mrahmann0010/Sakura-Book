import { pgEnum } from "drizzle-orm/pg-core";
import { paymentProviders, paymentVerificationOutcomes, reviewStatuses } from "@sakura/contracts";

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

/**
 * Which wallet a manual-transfer payment moved through — bKash, Rocket or
 * Nagad. Same source of truth as the payment-verification module's
 * `paymentProviders`: it names the same three collections the SMS gateway
 * files receipts under, so an order's stored provider can be handed straight
 * back to that lookup instead of it scanning all three.
 *
 * Null for cash on delivery, and for card once that ships — neither moves
 * through a wallet.
 */
export const paymentProviderEnum = pgEnum("payment_provider", paymentProviders);

/**
 * What a gateway cross-check concluded, as stored.
 *
 * Built from the contract's `paymentVerificationOutcomes` rather than
 * restating the four names, so the database, the API and the panel cannot
 * disagree about what outcomes exist. `NO_RECEIPT` is deliberately absent —
 * it is the admin endpoint's way of saying there was nothing to look up, and
 * no check happened, so there is no row to write.
 */
export const paymentVerificationOutcomeEnum = pgEnum(
  "payment_verification_outcome",
  paymentVerificationOutcomes,
);

/**
 * `VOIDED` is a payment that was recorded and then withdrawn — an admin
 * confirmed an order by mistake and reverted it. Distinct from `FAILED`, which
 * means the money did not arrive: a voided row means nobody ever should have
 * said it did. The row is kept rather than deleted, because "this was
 * confirmed at 09:12 and withdrawn at 09:20" is the fact worth having.
 */
export const paymentStatusEnum = pgEnum("payment_status", [
  "PENDING",
  "SUCCEEDED",
  "FAILED",
  "REFUNDED",
  "VOIDED",
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
 * A waitlist entry's lifecycle. SCREAMING_SNAKE like the other internal
 * enums — this is our own state machine, not a contract shared with a form
 * control.
 */
export const waitlistStatusEnum = pgEnum("waitlist_status", [
  "PENDING",
  "NOTIFIED",
  "CONVERTED",
  "CANCELLED",
]);

/**
 * A review's moderation state. Built from the contract's `reviewStatuses` for
 * the same reason `payment_verification_outcome` is built from its union: the
 * queue's tabs, the API's filter and this column must agree on what states
 * exist, and three hand-written lists eventually will not.
 *
 * SCREAMING_SNAKE and our own words, unlike `payment_method` — nothing on a
 * form control validates against these.
 */
export const reviewStatusEnum = pgEnum("review_status", reviewStatuses);

export const auditActionEnum = pgEnum("audit_action", [
  "CREATE",
  "UPDATE",
  "DELETE",
  "LOGIN",
  "LOGIN_FAILED",
  "LOGOUT",
  "TRANSITION",
  "ADJUST",
  /* Staff confirmed an order whose receipt was already on another live order,
     with a written reason. Its own value so "every time the duplicate-payment
     block was bypassed" is an indexed filter rather than a text search. */
  "DUPLICATE_RECEIPT_OVERRIDE",
  /* Staff withdrew a payment confirmation they had made in error, with a
     written reason. Its own value for the same reason as the override above:
     "how often are we confirming payments that had not arrived" is a question
     the shop should be able to ask as a filter. */
  "PAYMENT_REVERT",
]);
