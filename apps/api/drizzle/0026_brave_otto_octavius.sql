CREATE TYPE "public"."waitlist_invite_mode" AS ENUM('LOCKED', 'OPEN');--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "invite_mode" "waitlist_invite_mode";