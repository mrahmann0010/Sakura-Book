CREATE TABLE "waitlist_invite_waves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"allocation_id" uuid NOT NULL,
	"wave_number" integer NOT NULL,
	"invited_count" integer NOT NULL,
	"invited_quantity" integer NOT NULL,
	"ttl_hours" integer NOT NULL,
	"closes_at" timestamp with time zone NOT NULL,
	"sent_by_id" uuid,
	"sent_by_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "invite_wave_id" uuid;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "invite_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "waitlist_invite_waves" ADD CONSTRAINT "waitlist_invite_waves_allocation_id_waitlist_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."waitlist_allocations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_invite_waves" ADD CONSTRAINT "waitlist_invite_waves_sent_by_id_admin_users_id_fk" FOREIGN KEY ("sent_by_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_invite_waves_allocation_number_idx" ON "waitlist_invite_waves" USING btree ("allocation_id","wave_number");--> statement-breakpoint
CREATE INDEX "waitlist_invite_waves_allocation_id_idx" ON "waitlist_invite_waves" USING btree ("allocation_id");--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_invite_wave_id_waitlist_invite_waves_id_fk" FOREIGN KEY ("invite_wave_id") REFERENCES "public"."waitlist_invite_waves"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_wave_implies_token" CHECK ("waitlist_entries"."invite_wave_id" is null or "waitlist_entries"."invite_token" is not null);--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_invite_attempts_nonnegative" CHECK ("waitlist_entries"."invite_attempts" >= 0);--> statement-breakpoint
-- Hand-added: backfill the attempt count for invites that predate it.
--
-- The column defaults to 0, which for an entry that has already been texted a
-- link is not merely imprecise — it is the fairness sort's key. Left at 0,
-- everyone invited before this migration would tie with the people who have
-- never had a turn, and the first wave after deploy would hand second chances
-- out ahead of first ones.
--
-- Either mark says a link was issued: `invite_token` for one still on the row,
-- `invite_sms_at` for one since revoked or overwritten. `notified_at` is
-- deliberately not consulted — "Mark notified" records a message staff sent by
-- some other means, which issued no token and reserved no copy.
--
-- 1 rather than a true count: the history to reconstruct an exact number does
-- not exist, and the only thing the sort needs is "has had a turn".
UPDATE "waitlist_entries"
   SET "invite_attempts" = 1
 WHERE "invite_token" IS NOT NULL
    OR "invite_sms_at" IS NOT NULL;