import type { AdminWaitlistEntry } from "@sakura/contracts";

/**
 * Row → wire shape, plus the CSV rendering of the same list.
 *
 * The CSV lives here rather than in the service so the two views of an entry
 * are written next to each other: an export whose columns drift from the
 * table's is how staff end up trusting a spreadsheet that disagrees with the
 * screen it came from.
 */

export type WaitlistRow = {
  id: string;
  bookTitleSnapshot: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  quantity: number;
  locale: string;
  source: string;
  status: AdminWaitlistEntry["status"];
  notifiedAt: Date | null;
  internalNote: string | null;
  createdAt: Date;
  convertedOrderNumber: string | null;
};

export function toAdminWaitlistEntry(row: WaitlistRow): AdminWaitlistEntry {
  return {
    id: row.id,
    bookTitle: row.bookTitleSnapshot,
    customerName: row.customerName,
    customerEmail: row.customerEmail,
    customerPhone: row.customerPhone,
    quantity: row.quantity,
    locale: row.locale,
    source: row.source,
    status: row.status,
    notifiedAt: row.notifiedAt?.toISOString() ?? null,
    convertedOrderNumber: row.convertedOrderNumber,
    internalNote: row.internalNote,
    signedUpAt: row.createdAt.toISOString(),
  };
}

const CSV_COLUMNS = [
  "Signed up",
  "Name",
  "Phone",
  "Email",
  "Quantity",
  "Language",
  "Book",
  "Source",
  "Status",
  "Notified at",
  "Converted order",
  "Internal note",
] as const;

/**
 * One cell, quoted and de-fanged.
 *
 * The escaping is ordinary RFC 4180 — double the quotes, wrap the field —
 * but the leading apostrophe is not. A cell whose text begins with `=`, `+`,
 * `-`, `@`, a tab or a carriage return is executed as a formula by Excel and
 * Sheets when the file is opened, and every value here except the timestamps
 * was typed by a member of the public into a form on the internet. That makes
 * this export the one place in the app where customer input is handed to a
 * program that will run it, so it is neutralised on the way out.
 *
 * The apostrophe is consumed by the spreadsheet on import and does not appear
 * in the cell, so a genuine name starting with punctuation still reads
 * correctly.
 */
function cell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function toWaitlistCsv(entries: AdminWaitlistEntry[]): string {
  const lines = [CSV_COLUMNS.map((column) => cell(column)).join(",")];

  for (const entry of entries) {
    lines.push(
      [
        cell(entry.signedUpAt),
        cell(entry.customerName),
        cell(entry.customerPhone),
        cell(entry.customerEmail),
        cell(entry.quantity),
        cell(entry.locale),
        cell(entry.bookTitle ?? "General waitlist"),
        cell(entry.source),
        cell(entry.status),
        cell(entry.notifiedAt),
        cell(entry.convertedOrderNumber),
        cell(entry.internalNote),
      ].join(","),
    );
  }

  /* CRLF and a UTF-8 BOM: Excel on Windows opens a BOM-less UTF-8 file as
     Latin-1, which turns every Bangla name in the list into mojibake. The
     names are the reason the file exists, so the three bytes are worth it. */
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
