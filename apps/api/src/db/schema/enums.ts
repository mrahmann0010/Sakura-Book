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

export const paymentStatusEnum = pgEnum("payment_status", [
  "PENDING",
  "SUCCEEDED",
  "FAILED",
  "REFUNDED",
]);
