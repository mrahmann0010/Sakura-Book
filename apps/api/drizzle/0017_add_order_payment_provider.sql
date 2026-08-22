CREATE TYPE "public"."payment_provider" AS ENUM('bkash', 'nagad', 'rocket');--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "provider" "payment_provider";