ALTER TABLE "books" ADD COLUMN "waitlist_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "books_waitlist_enabled_idx" ON "books" USING btree ("title") WHERE "books"."waitlist_enabled";--> statement-breakpoint
-- Backfill the title /notify used to name in its own source, for the same
-- reason 0006 backfilled the reopening date: deploying this must not silently
-- withdraw an offer customers are already looking at. Staff edit the list from
-- the panel from here on.
UPDATE "books" SET "waitlist_enabled" = true WHERE "slug" = 'kanji-redical-guide-book';