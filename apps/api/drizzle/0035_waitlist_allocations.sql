CREATE TYPE "public"."waitlist_allocation_status" AS ENUM('OPEN', 'CLOSED');--> statement-breakpoint
CREATE TABLE "waitlist_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"copies" integer NOT NULL,
	"stock_snapshot" integer NOT NULL,
	"note" text,
	"status" "waitlist_allocation_status" DEFAULT 'OPEN' NOT NULL,
	"opened_by_id" uuid,
	"opened_by_email" text,
	"closed_at" timestamp with time zone,
	"closed_by_id" uuid,
	"closed_by_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_allocations_copies_positive" CHECK ("waitlist_allocations"."copies" > 0),
	CONSTRAINT "waitlist_allocations_closed_columns_together" CHECK (("waitlist_allocations"."status" = 'CLOSED') = ("waitlist_allocations"."closed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "invite_allocation_id" uuid;--> statement-breakpoint
ALTER TABLE "waitlist_allocations" ADD CONSTRAINT "waitlist_allocations_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_allocations" ADD CONSTRAINT "waitlist_allocations_opened_by_id_admin_users_id_fk" FOREIGN KEY ("opened_by_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_allocations" ADD CONSTRAINT "waitlist_allocations_closed_by_id_admin_users_id_fk" FOREIGN KEY ("closed_by_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_allocations_open_per_book_idx" ON "waitlist_allocations" USING btree ("book_id") WHERE "waitlist_allocations"."status" = 'OPEN';--> statement-breakpoint
CREATE INDEX "waitlist_allocations_book_id_idx" ON "waitlist_allocations" USING btree ("book_id");--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_invite_allocation_id_waitlist_allocations_id_fk" FOREIGN KEY ("invite_allocation_id") REFERENCES "public"."waitlist_allocations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "waitlist_entries_invite_allocation_id_idx" ON "waitlist_entries" USING btree ("invite_allocation_id");--> statement-breakpoint
-- Hand-edited: drizzle-kit also re-emitted `books_stock_quantity_nonnegative`,
-- `waitlist_entries_invite_columns_together` and
-- `waitlist_entries_invite_used_implies_token` here. All three were created by
-- hand-written migrations 0033 and 0034, whose snapshots were never
-- regenerated, so the generator believed they did not exist yet and re-adding
-- them would fail this migration with "constraint already exists". They are
-- recorded in 0035's snapshot, so this is the last migration that sees them as
-- new. Only the genuinely new constraint is kept below.
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_allocation_implies_token" CHECK ("waitlist_entries"."invite_allocation_id" is null or "waitlist_entries"."invite_token" is not null);