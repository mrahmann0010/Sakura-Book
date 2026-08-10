/* --------------------------------------------------------------------------
   Money

   Every amount inside the app is an integer of minor units (pence). Nothing
   adds, multiplies or compares a formatted string — parsing happens once, at
   the edge where the placeholder catalogue hands us "£14.00", and formatting
   happens once, on the way to the screen.

   `BookSummary.price` stays a display string on purpose (see
   components/domain/types.ts): components must not guess at currency. This
   module is the seam that turns those strings into arithmetic and back, and
   it is the one file that changes when the API starts sending minor units.
   -------------------------------------------------------------------------- */

export const CURRENCY = "GBP";

/** Pence → "£14.00". Locale-aware so the bn/ja routes group digits correctly. */
export function formatMoney(minor: number, locale = "en-GB"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: CURRENCY,
  }).format(minor / 100);
}

/**
 * "£14.00" → 1400. Tolerant of grouping separators and stray symbols, because
 * the input is display copy; anything unreadable returns 0 rather than NaN,
 * which would poison every total downstream.
 */
export function parseMoney(display: string): number {
  const amount = Number.parseFloat(display.replace(/[^0-9.]/g, ""));
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

/** A signed amount for a credit row — "−£3.50". */
export function formatCredit(minor: number, locale = "en-GB"): string {
  return `−${formatMoney(Math.abs(minor), locale)}`;
}
