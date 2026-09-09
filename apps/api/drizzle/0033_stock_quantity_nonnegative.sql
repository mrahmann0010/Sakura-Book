-- Stock may not go below zero, and the database is what says so.
--
-- `bookSummarySchema` has always declared `stockQuantity` as nonnegative, but
-- nothing enforced it. When a checkout path drove a title to -1, the API served
-- it happily and the web app's contract parse rejected the whole list — taking
-- out the catalog, the homepage and every book page at once, reported to the
-- browser as a minified React error with the real cause stripped out of it.
--
-- The repair below runs first because the constraint cannot be added over rows
-- that already violate it. Zero is the honest value for every one of them: a
-- negative count never meant "we owe someone a copy" to any reader of this
-- column, it only ever meant an order was allowed through that should not have
-- been.
--
-- Both statements are idempotent on purpose. The database this has to reach
-- refuses connections from anywhere but the host it runs on, so there is a
-- real chance of it being applied by hand in a container shell — and then of
-- `drizzle-kit migrate` meeting it again later from a machine that has the
-- journal but not the record of that manual run. A plain ADD CONSTRAINT would
-- abort the whole migration at that point, on the one path where the operator
-- has least context to work out why.
UPDATE "books" SET "stock_quantity" = 0 WHERE "stock_quantity" < 0;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'books_stock_quantity_nonnegative'
  ) THEN
    ALTER TABLE "books"
      ADD CONSTRAINT "books_stock_quantity_nonnegative" CHECK ("stock_quantity" >= 0);
  END IF;
END $$;
