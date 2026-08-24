import { join } from "node:path";
import postgres from "postgres";

/**
 * `npm run db:receipt-duplicates` — which live orders already share a payment
 * receipt.
 *
 * Read-only. Run it *before* migration 0019 on any database with real orders
 * in it: that migration adds a uniqueness constraint over the normalised
 * receipt, and it refuses to apply while data already violates it. This is how
 * you find out whether that will happen, and against what, without a release
 * being the thing that tells you.
 *
 * Deliberately not part of the migration. A migration that quietly cancelled
 * or edited orders to make its own constraint fit would be resolving a
 * money question by guessing, and which of two orders sharing a receipt is the
 * real one is not a decision code gets to make.
 *
 * Runs outside Nest and loads apps/api/.env by hand, like the seed and
 * drizzle-kit do, so it works in a release pipeline where the app is not up.
 *
 * It computes the normalisation inline rather than reading
 * `transaction_id_normalised`, so it works *before* the migration that adds
 * that column — which is the only time it is genuinely useful. The expression
 * is the same one the column is generated from.
 */

const NORMALISED = `nullif(upper(regexp_replace(coalesce(transaction_id, ''), '[^A-Za-z0-9]', '', 'g')), '')`;

type DuplicateRow = {
  receipt: string;
  order_count: number;
  order_numbers: string[];
  statuses: string[];
  total_cents: number[];
};

async function main(): Promise<void> {
  process.loadEnvFile(join(__dirname, "..", "..", "..", ".env"));

  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set — check apps/api/.env.");

  const client = postgres(url, {
    max: 1,
    ssl: process.env.DATABASE_SSL === "disable" ? false : "require",
    prepare: false,
  });

  try {
    /* The same population the unique index covers: live orders only. A
       cancelled order sharing a receipt with a live one is not a conflict —
       it released its claim, which is exactly what cancelling is for. */
    const rows = await client.unsafe<DuplicateRow[]>(`
      select
        ${NORMALISED} as receipt,
        count(*)::int as order_count,
        array_agg(order_number order by created_at) as order_numbers,
        array_agg(status::text order by created_at) as statuses,
        array_agg(total_cents order by created_at) as total_cents
      from orders
      where ${NORMALISED} is not null
        and status <> 'CANCELLED'
        and status <> 'REFUNDED'
      group by 1
      having count(*) > 1
      order by count(*) desc, 1
    `);

    if (rows.length === 0) {
      console.log("No live orders share a payment receipt. Migration 0019 will apply cleanly.");
      return;
    }

    console.log(
      `${rows.length} receipt(s) are held by more than one live order.\n` +
        `Migration 0019 will refuse to apply until each is resolved.\n`,
    );

    for (const row of rows) {
      console.log(`Receipt ${row.receipt} — ${row.order_count} orders`);

      row.order_numbers.forEach((orderNumber, index) => {
        const taka = (row.total_cents[index] / 100).toFixed(2);
        console.log(`  ${orderNumber}  ${row.statuses[index].padEnd(18)} ৳${taka}`);
      });

      console.log("");
    }

    console.log(
      "Resolve each by cancelling or refunding the orders that were not really paid for —\n" +
        "that releases their claim on the receipt. Where a customer genuinely paid once for\n" +
        "two orders, confirm one and use the duplicate-receipt override on the other after\n" +
        "the migration lands.",
    );

    /* A non-zero exit so a release script can gate on this without parsing
       stdout. Nothing has been changed either way — this only reads. */
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
