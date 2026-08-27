CREATE TYPE "public"."waitlist_status" AS ENUM('PENDING', 'NOTIFIED', 'CONVERTED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "waitlist_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid,
	"book_title_snapshot" text,
	"customer_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"customer_phone" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"locale" text NOT NULL,
	"source" text NOT NULL,
	"status" "waitlist_status" DEFAULT 'PENDING' NOT NULL,
	"notified_at" timestamp with time zone,
	"converted_order_id" uuid,
	"internal_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_converted_order_id_orders_id_fk" FOREIGN KEY ("converted_order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_entries_phone_book_idx" ON "waitlist_entries" USING btree ("customer_phone","book_id") WHERE "waitlist_entries"."book_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_entries_phone_general_idx" ON "waitlist_entries" USING btree ("customer_phone") WHERE "waitlist_entries"."book_id" is null;--> statement-breakpoint
CREATE INDEX "waitlist_entries_status_idx" ON "waitlist_entries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "waitlist_entries_book_id_idx" ON "waitlist_entries" USING btree ("book_id");