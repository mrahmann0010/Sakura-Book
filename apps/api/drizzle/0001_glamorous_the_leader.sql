CREATE TYPE "public"."payment_method" AS ENUM('cash-on-delivery', 'manual-transfer', 'card');--> statement-breakpoint
-- USING added by hand: Postgres has no automatic text -> jsonb cast and rejects
-- this statement without one, empty table or not. `to_jsonb(...)` rather than
-- `::jsonb` because the old values are bare names, not JSON documents — this
-- turns "Ana Ruiz" into the string "Ana Ruiz" instead of failing to parse it.
-- The new column holds an array, so any pre-existing row would still need a
-- backfill; there are none, which is the only reason this migration is safe.
ALTER TABLE "order_items" ALTER COLUMN "author_names_snapshot" SET DATA TYPE jsonb USING to_jsonb("author_names_snapshot");--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "order_number" text NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_method" "payment_method" NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_order_number_unique" UNIQUE("order_number");