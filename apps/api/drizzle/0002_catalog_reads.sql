-- Added by hand, and both statements matter on Supabase.
--
-- `extensions` is where a Supabase project keeps its extensions; it exists on
-- every Supabase database and is created here so the same migration also
-- applies to a bare Postgres. Installing pg_trgm into it rather than into
-- `public` keeps the extension's objects out of the schema the application
-- owns — and out of anything PostgREST exposes.
--
-- The gin_trgm_ops operator class below does not exist until the extension is
-- installed, so this must stay ahead of every statement that references it.
CREATE SCHEMA IF NOT EXISTS extensions;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;--> statement-breakpoint
CREATE TABLE "book_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"reviewer_name" text NOT NULL,
	"title" text,
	"body" text,
	"order_number" varchar(32),
	"is_published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_reviews_rating_range" CHECK ("book_reviews"."rating" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "delivery_regions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" text NOT NULL,
	"delivery_cents_override" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_regions_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "book_reviews" ADD CONSTRAINT "book_reviews_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "book_reviews_book_published_idx" ON "book_reviews" USING btree ("book_id") WHERE "book_reviews"."is_published";--> statement-breakpoint
CREATE INDEX "authors_name_trgm_idx" ON "authors" USING gin ("name" extensions.gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "books_title_trgm_idx" ON "books" USING gin ("title" extensions.gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "books_active_created_idx" ON "books" USING btree ("created_at" DESC NULLS LAST) WHERE "books"."is_active";--> statement-breakpoint
CREATE INDEX "books_publisher_idx" ON "books" USING btree ("publisher_id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_provider_reference_unique" UNIQUE("provider","provider_reference_id");