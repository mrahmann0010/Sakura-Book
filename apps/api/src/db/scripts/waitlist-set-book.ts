import { join } from "node:path";
import postgres from "postgres";

/**
 * `npm run db:waitlist-set-book -- --title="Kanji Radical Guide" --confirm`
 *
 * Fixes waitlist entries that were signed up as general (book-less,
 * `bookId is null`) but staff now know were actually waiting for one
 * specific book — e.g. entries collected before a per-book waitlist button
 * existed, now being invited off a book-specific link.
 *
 * Both the checkout page and the token's `redeem`/`consume` checks
 * (waitlist-invite.service.ts) read `bookId`/`inviteMode` live off the
 * entry row by token — nothing about mode is baked in at the moment a token
 * is issued. So for a row whose token is still unused and unexpired, this
 * script also flips `inviteMode` to LOCKED in the same update: the exact
 * link already texted to the customer starts opening as a locked Kanji
 * Radical Guide checkout, with no new token and no new SMS. A row with no
 * live token (never invited, already used, or expired) only gets `bookId`
 * fixed — staff still have to invite/re-invite those through the admin UI,
 * which will now compute LOCKED on its own since `bookId` is set.
 *
 * Dry-run by default, same as waitlist-purge: prints what it matched and
 * stops. `--confirm` is what actually writes.
 *
 * A phone can already hold a real per-book entry for the same book
 * (`waitlist_entries_phone_book_idx`), which a blind update would collide
 * with — those rows are reported separately and skipped rather than
 * failing the whole batch.
 */

type EntryRow = {
  id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  quantity: number;
  status: string;
  invite_token: string | null;
  invite_mode: string | null;
  invite_used_at: Date | null;
  invite_expires_at: Date | null;
  created_at: Date;
};

function readFlag(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = argv.find((arg) => arg.startsWith(prefix));
  const value = found?.slice(prefix.length).trim();
  return value === "" ? undefined : value;
}

function hasLiveToken(row: EntryRow): boolean {
  return (
    row.invite_token !== null &&
    row.invite_used_at === null &&
    row.invite_expires_at !== null &&
    row.invite_expires_at.getTime() > Date.now()
  );
}

function describe(row: EntryRow): string {
  const when = row.created_at.toISOString().slice(0, 16).replace("T", " ");
  const tokenState = !row.invite_token
    ? "never invited"
    : row.invite_used_at
      ? "already used"
      : hasLiveToken(row)
        ? "live link -> will relock in place"
        : "expired";
  return (
    `  ${row.customer_name} <${row.customer_email}> ${row.customer_phone}\n` +
    `    ${row.status}  ×${row.quantity}  mode=${row.invite_mode ?? "none"}  ${tokenState}  ${when}`
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const title = readFlag(argv, "title");
  const confirmed = argv.includes("--confirm");

  if (!title) {
    throw new Error(
      'Nothing to match against. Usage:\n' +
        '  npm run db:waitlist-set-book -- --title="Kanji Radical Guide"\n' +
        '  npm run db:waitlist-set-book -- --title="Kanji Radical Guide" --confirm',
    );
  }

  process.loadEnvFile(join(__dirname, "..", "..", "..", ".env"));

  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set — check apps/api/.env.");

  const client = postgres(url, {
    max: 1,
    ssl: process.env.DATABASE_SSL === "disable" ? false : "require",
    prepare: false,
  });

  try {
    const books = await client<{ id: string; title: string }[]>`
      select id, title from books where title ilike ${title} order by title
    `;

    if (books.length === 0) {
      console.log(`No book title matches "${title}".`);
      return;
    }
    if (books.length > 1) {
      console.log(`"${title}" matches more than one book — be more specific:`);
      for (const book of books) console.log(`  ${book.id}  ${book.title}`);
      process.exitCode = 1;
      return;
    }

    const book = books[0]!;
    console.log(`Target book: ${book.title} (${book.id})\n`);

    const general = await client<EntryRow[]>`
      select id, customer_name, customer_email, customer_phone, quantity,
             status, invite_token, invite_mode, invite_used_at, invite_expires_at,
             created_at
      from waitlist_entries
      where book_id is null and status not in ('CANCELLED', 'CONVERTED')
      order by created_at
    `;

    if (general.length === 0) {
      console.log("No open general waitlist entries to fix.");
      return;
    }

    const conflicting = await client<{ customer_phone: string }[]>`
      select customer_phone from waitlist_entries
      where book_id = ${book.id}
    `;
    const takenPhones = new Set(conflicting.map((row) => row.customer_phone));

    const clear = general.filter((row) => !takenPhones.has(row.customer_phone));
    const blocked = general.filter((row) => takenPhones.has(row.customer_phone));

    console.log(`${clear.length} general entr${clear.length === 1 ? "y" : "ies"} to set to ${book.title}:\n`);
    for (const row of clear) console.log(`${describe(row)}\n`);

    if (blocked.length > 0) {
      console.log(
        `${blocked.length} skipped — this phone already has a separate ${book.title} entry:\n`,
      );
      for (const row of blocked) console.log(`${describe(row)}\n`);
    }

    if (clear.length === 0) {
      console.log("Nothing left to update.");
      return;
    }

    if (!confirmed) {
      console.log("Dry run — nothing updated. Re-run with --confirm to write the above.");
      return;
    }

    const toRelock = clear.filter(hasLiveToken);
    const toBookOnly = clear.filter((row) => !hasLiveToken(row));

    let relocked = 0;
    if (toRelock.length > 0) {
      const rows = await client<{ id: string }[]>`
        update waitlist_entries
        set book_id = ${book.id}, book_title_snapshot = ${book.title},
            invite_mode = 'LOCKED', updated_at = now()
        where id in ${client(toRelock.map((row) => row.id))}
        returning id
      `;
      relocked = rows.length;
    }

    let bookOnly = 0;
    if (toBookOnly.length > 0) {
      const rows = await client<{ id: string }[]>`
        update waitlist_entries
        set book_id = ${book.id}, book_title_snapshot = ${book.title}, updated_at = now()
        where id in ${client(toBookOnly.map((row) => row.id))}
        returning id
      `;
      bookOnly = rows.length;
    }

    console.log(`Updated ${relocked + bookOnly} waitlist entr${relocked + bookOnly === 1 ? "y" : "ies"} to ${book.title}.`);
    if (relocked > 0) {
      console.log(
        `  ${relocked} had a live, unused invite link — same link now opens locked to ${book.title}. No SMS sent.`,
      );
    }
    if (bookOnly > 0) {
      console.log(
        `  ${bookOnly} had no live link (never invited / already used / expired) — ` +
          "invite/re-invite them from the admin waitlist page; it will now send LOCKED automatically.",
      );
    }
  } finally {
    await client.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
