/* --------------------------------------------------------------------------
   One receipt, however it was typed.

   Moved here from the old payment-verification module when the shop stopped
   reading the gateway's database: the gateway now normalises transaction IDs
   on its side, and what remains is our own question — "is this receipt
   already on another of our orders?" — which belongs with orders.
   -------------------------------------------------------------------------- */

/**
 * The form two receipts are compared in: uppercased, with every
 * non-alphanumeric character removed.
 *
 * This is the TypeScript half of a pair. The other half is the
 * `transaction_id_normalised` generated column on `orders`, and the two must
 * produce the same string for the same input — `receipt-normalisation.spec.ts`
 * pins that against a real database, because the last time these drifted the
 * check silently stopped catching reuse.
 *
 * The class is `[^A-Za-z0-9]` rather than `\s` on purpose. It removes every
 * kind of space including the non-breaking one JS matches and POSIX does not,
 * it removes the zero-width characters neither matched, and it removes the
 * hyphens and underscores that made `PAY-123` and `PAY123` two receipts.
 *
 * Returns "" for a value with nothing alphanumeric in it, which every caller
 * reads as "no receipt" — the column stores NULL for the same case.
 */
export function normaliseTransactionId(value: string | null | undefined): string {
  return (value ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}
