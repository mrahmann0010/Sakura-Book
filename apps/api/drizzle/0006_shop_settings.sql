CREATE TABLE "shop_settings" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"delivery_flat_cents" integer,
	"free_delivery_threshold_cents" integer,
	"updated_by_id" uuid,
	"updated_by_email" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_settings_singleton" CHECK ("shop_settings"."id" = 'singleton'),
	CONSTRAINT "shop_settings_non_negative" CHECK (("shop_settings"."delivery_flat_cents" is null or "shop_settings"."delivery_flat_cents" >= 0)
          and ("shop_settings"."free_delivery_threshold_cents" is null or "shop_settings"."free_delivery_threshold_cents" >= 0))
);
--> statement-breakpoint
ALTER TABLE "shop_settings" ADD CONSTRAINT "shop_settings_updated_by_id_admin_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."admin_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- The 0003 lockdown, applied to this table — see the note in 0004 for why
-- every CREATE TABLE has to carry these lines. `shop_settings` holds the
-- numbers every cart in the shop is priced against, so a writable copy of it
-- exposed over PostgREST would be a way to change what customers are charged
-- without touching the API.
ALTER TABLE "shop_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Indexes for the dashboard's low-stock list and bestseller list.
--
-- Both are partial on `is_active`, which is what makes them small: the queries
-- behind them never look at delisted titles, so indexing those would be paying
-- for rows no plan will ever read.
--
-- The low-stock index cannot be a plain btree on `stock_quantity`, because the
-- comparison is against another column on the same row (`low_stock_threshold`)
-- rather than a constant — there is no value to seek on. Indexing the
-- expression is what gives the planner something to use; without it, the
-- dashboard scans the whole catalog on every load.
CREATE INDEX "books_low_stock_idx" ON "books" ((stock_quantity - low_stock_threshold))
  WHERE is_active;--> statement-breakpoint
CREATE INDEX "books_units_sold_idx" ON "books" (units_sold DESC)
  WHERE is_active;
