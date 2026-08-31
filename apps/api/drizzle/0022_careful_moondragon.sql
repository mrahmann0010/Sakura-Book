CREATE TYPE "public"."review_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'SPAM');--> statement-breakpoint
CREATE TABLE "initial_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_name" varchar(80),
	"author_email" varchar(254),
	"rating" integer,
	"title" varchar(120),
	"body" text NOT NULL,
	"status" "review_status" DEFAULT 'PENDING' NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"order_id" uuid,
	"moderator_note" text,
	"published_at" timestamp with time zone,
	"ip_hash" varchar(64),
	"user_agent" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "initial_reviews_rating_range" CHECK ("initial_reviews"."rating" between 1 and 5),
	CONSTRAINT "initial_reviews_published_at_matches_status" CHECK (("initial_reviews"."status" = 'APPROVED') = ("initial_reviews"."published_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "initial_reviews" ADD CONSTRAINT "initial_reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "initial_reviews_published_idx" ON "initial_reviews" USING btree ("is_featured","published_at" DESC NULLS LAST) WHERE "initial_reviews"."status" = 'APPROVED';--> statement-breakpoint
CREATE INDEX "initial_reviews_status_created_idx" ON "initial_reviews" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "initial_reviews_ip_hash_idx" ON "initial_reviews" USING btree ("ip_hash");--> statement-breakpoint

-- Deny by default, like every other table here.
--
-- 0003 enabled RLS by looping over the tables that existed when it ran, so a
-- table added afterwards has to say this for itself — see 0004 and 0006, which
-- do the same. It does not affect the API: the owning role bypasses RLS, and
-- FORCE ROW LEVEL SECURITY is deliberately not set. This is the backstop for
-- the anon/authenticated roles reaching `author_email` and `ip_hash` over
-- PostgREST if a privilege is ever granted back by a dashboard action.
ALTER TABLE "initial_reviews" ENABLE ROW LEVEL SECURITY;
