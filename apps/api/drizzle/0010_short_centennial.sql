ALTER TABLE "pre_order_orders" ADD COLUMN "payment_method" "payment_method" NOT NULL;--> statement-breakpoint
ALTER TABLE "pre_order_orders" ADD COLUMN "sender_number" text;--> statement-breakpoint
ALTER TABLE "pre_order_orders" ADD COLUMN "transaction_id" text;