CREATE TYPE "public"."order_payment_status" AS ENUM('UNPAID', 'PAID', 'COLLECTED', 'REMITTED', 'REFUNDED');--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_status" "order_payment_status" DEFAULT 'UNPAID' NOT NULL;--> statement-breakpoint
/* Backfill: every existing order gets the payment status the rule in
   apps/api/src/orders/payment-status.ts would have given it, had the column
   existed from the start. Before this, "paid" was read off order status, so
   each case below is that same reading made explicit.

   - REFUNDED orders: the money went back.
   - Cash on delivery, DELIVERED: the courier collected the cash. Whether the
     courier has since paid the shop was never recorded, so COLLECTED rather
     than REMITTED; staff mark remittances from here on.
   - Prepaid at or past PAYMENT_CONFIRMED and not cancelled: paid.
   - Prepaid and CANCELLED, where the last live status before cancelling was
     PAYMENT_CONFIRMED or PROCESSING: paid, and a refund is still owed. "Last
     live" is the newest non-CANCELLED history row; rows written in one
     transaction share a timestamp, so every row at that newest time is
     considered, and those ties can only be PAYMENT_CONFIRMED/PROCESSING pairs
     from a single advance.
   - Everything else stays at the column default, UNPAID. That includes COD
     orders accepted but not yet delivered, which the old reading counted as
     paid. Those are the orders this column exists to tell apart. */
UPDATE "orders" o
SET "payment_status" = CASE
  WHEN o."status" = 'REFUNDED' THEN 'REFUNDED'::"order_payment_status"
  WHEN o."payment_method" = 'cash-on-delivery' AND o."status" = 'DELIVERED' THEN 'COLLECTED'::"order_payment_status"
  WHEN o."payment_method" <> 'cash-on-delivery'
    AND o."status" IN ('PAYMENT_CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED') THEN 'PAID'::"order_payment_status"
  WHEN o."payment_method" <> 'cash-on-delivery'
    AND o."status" = 'CANCELLED'
    AND EXISTS (
      SELECT 1
      FROM "order_status_history" h
      WHERE h."order_id" = o."id"
        AND h."status" IN ('PAYMENT_CONFIRMED', 'PROCESSING')
        AND h."created_at" = (
          SELECT max(h2."created_at")
          FROM "order_status_history" h2
          WHERE h2."order_id" = o."id" AND h2."status" <> 'CANCELLED'
        )
    ) THEN 'PAID'::"order_payment_status"
  ELSE 'UNPAID'::"order_payment_status"
END;
