ALTER TABLE "shop_settings" ADD COLUMN "reopen_date" date;--> statement-breakpoint
-- Backfill the date the /notify page has been announcing from a hardcoded
-- constant (REOPEN_DATE = "September 15, 2026"). Without this the column ships
-- null on every existing shop, and the reopening line disappears from a live
-- page the moment this deploys — retracting a date customers have already been
-- given, until someone happens to open Settings and type it back in.
--
-- Guarded on the row existing: a shop that has never saved its settings has no
-- singleton row, and inserting one here would flip `source` to "database" for
-- shipping and payments, which have their own "null means use the environment"
-- meaning. Such a shop gets a null reopen date, which the page renders as
-- silence — correct, since it has nothing saved to contradict.
UPDATE "shop_settings" SET "reopen_date" = DATE '2026-09-15' WHERE "id" = 'singleton';
