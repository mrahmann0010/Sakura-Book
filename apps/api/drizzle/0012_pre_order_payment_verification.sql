ALTER TABLE "pre_order_orders" ADD COLUMN "payment_verification" jsonb;--> statement-breakpoint
CREATE INDEX "pre_order_orders_transaction_id_idx" ON "pre_order_orders" USING btree ("transaction_id");