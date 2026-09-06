CREATE TYPE "public"."waitlist_invite_sms_status" AS ENUM('SENT', 'FAILED');--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "invite_sms_status" "waitlist_invite_sms_status";--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "invite_sms_error" text;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "invite_sms_at" timestamp with time zone;