import { join } from "node:path";
import postgres from "postgres";

/**
 * `npm run db:waitlist-purge -- --email=someone@example.com` — remove waitlist
 * entries from the live table by phone or email.
 *
 * Exists because the waitlist is the one table a smoke test has to write to in
 * order to prove anything: the duplicate-phone rule is a partial unique index,
 * so the only way to check the 409 path is to leave a real row behind, and the
 * same index then blocks that phone from ever signing up for real. Deleting
 * such a row by hand means a psql session against production and a `delete`
 * typed from memory, which is a worse habit than a script that states what it
 * matches before it touches anything.
 *
 * Dry-run by default. It prints the rows it matched and stops; `--confirm` is
 * what actually deletes. That order is deliberate — a phone typo in the
 * argument silently matching a real customer's signup is the failure this is
 * shaped to prevent, and the printed row is what catches it.
 *
 * Not for clearing the list. There is no "delete everything" flag and no
 * pattern matching: a selector is one exact email or one exact phone, because
 * the wide selector is the one that turns a cleanup into an incident. Removing
 * a real customer at their request is a legitimate use — this is also the
 * script for that.
 *
 * Runs outside Nest and loads apps/api/.env by hand, like the seed and
 * receipt-duplicates do, so it works against a database with the app down.
 */

type EntryRow = {
  id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  quantity: number;
  locale: string;
  source: string;
  status: string;
  book_title_snapshot: string | null;
  converted_order_id: string | null;
  created_at: Date;
};

type Selector = { column: "customer_email" | "customer_phone"; value: string };

/** One exact selector, or a thrown explanation of what was expected instead. */
function parseSelector(argv: string[]): Selector {
  const email = readFlag(argv, "email");
  const phone = readFlag(argv, "phone");

  if (email && phone) {
    throw new Error("Pass --email or --phone, not both — a selector matches one column.");
  }

  if (email) return { column: "customer_email", value: email };
  if (phone) return { column: "customer_phone", value: phone };

  throw new Error(
    "Nothing to match. Usage:\n" +
      "  npm run db:waitlist-purge -- --email=someone@example.com\n" +
      "  npm run db:waitlist-purge -- --phone=01712345678 --confirm",
  );
}

function readFlag(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = argv.find((arg) => arg.startsWith(prefix));
  const value = found?.slice(prefix.length).trim();
  return value === "" ? undefined : value;
}

function describe(row: EntryRow): string {
  const when = row.created_at.toISOString().slice(0, 16).replace("T", " ");
  const book = row.book_title_snapshot ?? "general waitlist";
  return (
    `  ${row.customer_name} <${row.customer_email}> ${row.customer_phone}\n` +
    `    ${row.status}  ×${row.quantity}  ${row.locale}  ${row.source}  ${book}  ${when}`
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const selector = parseSelector(argv);
  const confirmed = argv.includes("--confirm");

  process.loadEnvFile(join(__dirname, "..", "..", "..", ".env"));

  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set — check apps/api/.env.");

  const client = postgres(url, {
    max: 1,
    ssl: process.env.DATABASE_SSL === "disable" ? false : "require",
    prepare: false,
  });

  try {
    const rows = await client<EntryRow[]>`
      select id, customer_name, customer_email, customer_phone, quantity,
             locale, source, status, book_title_snapshot, converted_order_id,
             created_at
      from waitlist_entries
      where ${client(selector.column)} = ${selector.value}
      order by created_at
    `;

    if (rows.length === 0) {
      console.log(`No waitlist entry has ${selector.column} = ${selector.value}.`);
      return;
    }

    console.log(`${rows.length} entr${rows.length === 1 ? "y" : "ies"} matched:\n`);
    for (const row of rows) console.log(`${describe(row)}\n`);

    /* A converted entry is sales history — it is the join that answers "did
       this signup become an order", and the order it points at outlives it.
       Deleting one is a decision about records rather than about test data, so
       it stops here rather than being waved through by the same --confirm. */
    const converted = rows.filter((row) => row.converted_order_id !== null);
    if (converted.length > 0) {
      console.log(
        `${converted.length} of these converted into an order and are sales history.\n` +
          "Refusing to delete. Remove the conversion link first if this is really intended.",
      );
      process.exitCode = 1;
      return;
    }

    if (!confirmed) {
      console.log("Dry run — nothing deleted. Re-run with --confirm to delete the above.");
      return;
    }

    const deleted = await client<{ id: string }[]>`
      delete from waitlist_entries
      where id in ${client(rows.map((row) => row.id))}
      returning id
    `;

    console.log(`Deleted ${deleted.length} waitlist entr${deleted.length === 1 ? "y" : "ies"}.`);
  } finally {
    await client.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
