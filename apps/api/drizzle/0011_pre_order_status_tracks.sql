CREATE TYPE "public"."pre_order_payment_status" AS ENUM('PENDING', 'ACCEPTED', 'REJECTED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."pre_order_fulfillment_status" AS ENUM('NOT_STARTED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED');--> statement-breakpoint
ALTER TABLE "pre_order_orders" ADD COLUMN "payment_status" "pre_order_payment_status" DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE "pre_order_orders" ADD COLUMN "fulfillment_status" "pre_order_fulfillment_status" DEFAULT 'NOT_STARTED' NOT NULL;--> statement-breakpoint
ALTER TABLE "pre_order_orders" ADD COLUMN "internal_note" text;--> statement-breakpoint
--
-- Backfill before the old column goes. The single `status` was only ever the
-- payment track: CONFIRMED meant "we read the transaction ID and accepted it",
-- never "it shipped" — there was no shipping machinery to mean anything else.
-- So payment_status takes the old value and fulfillment_status keeps its
-- NOT_STARTED default for every existing row, which is true: nothing has been
-- dispatched, because the book has not been printed.
--
-- CANCELLED is the one ambiguous value, since the old column could not say
-- which track a cancellation belonged to. It is read as a rejected payment
-- *and* a cancelled fulfilment, the only reading under which the derived
-- customer-facing status still comes out CANCELLED.
--
UPDATE "pre_order_orders" SET "payment_status" = 'ACCEPTED' WHERE "status" = 'CONFIRMED';--> statement-breakpoint
UPDATE "pre_order_orders" SET "payment_status" = 'REJECTED', "fulfillment_status" = 'CANCELLED' WHERE "status" = 'CANCELLED';--> statement-breakpoint
ALTER TABLE "pre_order_orders" DROP COLUMN "status";--> statement-breakpoint
DROP TYPE "public"."pre_order_status";--> statement-breakpoint
CREATE INDEX "pre_order_orders_payment_status_idx" ON "pre_order_orders" USING btree ("payment_status");
