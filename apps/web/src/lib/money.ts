/* --------------------------------------------------------------------------
   Money

   Every amount in the app is an integer of minor units, exactly as the API
   sends it: `priceCents: 1400`, never "৳14.00". Nothing adds, multiplies or
   compares a formatted string, and nothing parses one — formatting happens
   once, on the way to the screen, and never runs backwards.

   That last point is the change this file records. `priceCents` used to be a
   display string on BookSummary, on the theory that currency was a data
   concern components should not guess at. The theory was fine; the shape was
   not. A preformatted string cannot be summed for a cart total, cannot be
   compared for a price sort, and cannot be re-rendered for a second locale —
   so the code did all three anyway, by parsing the string back into a number.
   Three locales make that untenable rather than merely ugly: "৳1,400" and
   "১,৪০০৳" are the same amount, and only one of them survives a regex.
   -------------------------------------------------------------------------- */

/**
 * ISO 4217. One currency, matching the API's `CURRENCY` env var — the shop
 * serves Bangladesh and prices in taka.
 *
 * Amounts that come from the API carry their own `currency` field (see
 * `CartQuote`); this is the default for the placeholder catalogue, which has
 * no server to ask yet.
 */
export const CURRENCY = "BDT";

/**
 * Minor units → a formatted amount. Locale-aware, because the app ships in
 * three: `en` groups as 1,400, `bn` as ১,৪০০, `ja` as ¥-style grouping with no
 * decimals of its own. Intl knows all of that; a template string does not.
 */
export function formatMoney(minor: number, locale = "en-GB", currency = CURRENCY): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(minor / 100);
}

/**
 * App locale → BCP 47 tag for Intl.
 *
 * Only `en` needs translating: the route segment is a bare language code, and
 * bare "en" formats as en-US (৳1,400.00 is the same, but the date and number
 * defaults elsewhere are not). `bn` and `ja` are already valid tags and are
 * passed through — deliberately not pinned to bn-BD/ja-JP, so a reader in
 * another region keeps their own conventions.
 *
 * Typed loosely so this module does not depend on the i18n settings, which
 * would make every money format a client-bundle concern.
 */
export function intlLocale(locale: string): string {
  return locale === "en" ? "en-GB" : locale;
}

/** A signed amount for a credit row — "−৳3.50". */
export function formatCredit(minor: number, locale = "en-GB", currency = CURRENCY): string {
  return `−${formatMoney(Math.abs(minor), locale, currency)}`;
}
