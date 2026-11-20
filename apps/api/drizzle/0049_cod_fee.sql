ALTER TABLE "shop_settings" ADD COLUMN "cod_fee_dhaka_bps" integer;--> statement-breakpoint
ALTER TABLE "shop_settings" ADD COLUMN "cod_fee_outside_bps" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cod_fee_cents" integer DEFAULT 0 NOT NULL;