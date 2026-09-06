ALTER TABLE "waitlist_entries" ADD COLUMN "invite_token" text;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "invite_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "invite_used_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_entries_invite_token_idx" ON "waitlist_entries" USING btree ("invite_token") WHERE "waitlist_entries"."invite_token" is not null;