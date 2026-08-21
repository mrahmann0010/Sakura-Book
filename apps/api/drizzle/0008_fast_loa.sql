CREATE TYPE "public"."pre_order_status" AS ENUM('PENDING', 'CONFIRMED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "pre_order_books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"author_name" text NOT NULL,
	"description" text NOT NULL,
	"page_count" integer,
	"price_cents" integer NOT NULL,
	"cover_image_url" text NOT NULL,
	"cover_image_alt" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pre_order_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" text NOT NULL,
	"pre_order_book_id" uuid,
	"book_title_snapshot" text NOT NULL,
	"author_name_snapshot" text NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"quantity" integer NOT NULL,
	"subtotal_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"customer_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"customer_phone" text NOT NULL,
	"shipping_address" jsonb NOT NULL,
	"customer_note" text,
	"status" "pre_order_status" DEFAULT 'PENDING' NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pre_order_orders_order_number_unique" UNIQUE("order_number"),
	CONSTRAINT "pre_order_orders_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "pre_order_orders" ADD CONSTRAINT "pre_order_orders_pre_order_book_id_pre_order_books_id_fk" FOREIGN KEY ("pre_order_book_id") REFERENCES "public"."pre_order_books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pre_order_books_active_idx" ON "pre_order_books" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "pre_order_orders_created_idx" ON "pre_order_orders" USING btree ("created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "pre_order_orders_customer_email_idx" ON "pre_order_orders" USING btree ("customer_email");--> statement-breakpoint
CREATE INDEX "pre_order_orders_customer_name_trgm_idx" ON "pre_order_orders" USING gin ("customer_name" extensions.gin_trgm_ops);