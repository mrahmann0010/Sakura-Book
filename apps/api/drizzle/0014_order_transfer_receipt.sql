-- Store the manual-transfer receipt on `orders`.
--
-- `checkoutSchema` has always required `senderNumber` and `transactionId` when
-- the customer pays by bKash/Nagad, and the API validated both and then
-- dropped them: `orders` had no column for either, so CheckoutService's insert
-- simply omitted them. Every manual-transfer order placed so far was recorded
-- without the receipt the customer typed.
--
-- Purely additive. Both columns are nullable — cash on delivery has no receipt,
-- and neither does any order placed before this migration.
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "sender_number" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "transaction_id" text;--> statement-breakpoint

-- "Which order is this receipt for?", asked with a payment statement open
-- beside the queue. A lookup rather than a scan.
CREATE INDEX "orders_transaction_id_idx" ON "orders" USING btree ("transaction_id");
