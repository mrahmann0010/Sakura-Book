CREATE TYPE "public"."cod_confirmation_channel" AS ENUM('FACEBOOK', 'PHONE', 'OTHER');--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'COD_APPROVED';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'COD_DENIED';--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cod_acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cod_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cod_confirmed_by" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cod_confirmation_channel" "cod_confirmation_channel";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cod_confirmation_note" text;