ALTER TYPE "public"."audit_action" ADD VALUE 'GATEWAY_CLAIM_OVERRIDE';--> statement-breakpoint
ALTER TYPE "public"."payment_verification_outcome" ADD VALUE 'CLAIMED';--> statement-breakpoint
ALTER TYPE "public"."payment_verification_outcome" ADD VALUE 'PENDING_ARRIVAL';--> statement-breakpoint
ALTER TYPE "public"."payment_verification_outcome" ADD VALUE 'ALREADY_CLAIMED';--> statement-breakpoint
ALTER TYPE "public"."payment_verification_outcome" ADD VALUE 'RELEASED';--> statement-breakpoint
ALTER TYPE "public"."payment_verification_outcome" ADD VALUE 'REJECTED';--> statement-breakpoint
ALTER TYPE "public"."payment_verification_outcome" ADD VALUE 'MISCONFIGURED';--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_claim_key" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_claim_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_claim_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_verifications" ADD COLUMN "claim_key" text;--> statement-breakpoint
ALTER TABLE "payment_verifications" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "orders_payment_claim_retry_idx" ON "orders" USING btree ("payment_claim_retry_at") WHERE "payment_claim_retry_at" IS NOT NULL;