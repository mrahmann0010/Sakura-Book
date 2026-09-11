import { intlLocale } from "./money";

/* --------------------------------------------------------------------------
   Dates, formatted for the reader rather than for whoever's machine happens to
   be rendering.

   Every call here takes an explicit locale. A bare `toLocaleString()` reads
   the *environment's* locale, which in a server component is the Node
   process — so an order placed by a Bangla-reading customer was being stamped
   in whatever the container was configured for, and the same order rendered
   client-side in the tracking list disagreed with it. Both are fixed by never
   calling the zero-argument form.

   `timeZone` is pinned for the same reason. The shop ships from and to one
   country; a timestamp is about when staff did something in Dhaka, and
   rendering it in the viewer's zone would put a 9am dispatch at 5am for a
   customer whose phone is set to UTC.
   -------------------------------------------------------------------------- */

/** Bangladesh Standard Time. The shop's one operating timezone. */
const SHOP_TIME_ZONE = "Asia/Dhaka";

/** "11 Sep 2026, 14:05" — a timeline entry, where the hour matters. */
export function formatDateTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: SHOP_TIME_ZONE,
  }).format(new Date(iso));
}

/** "11 Sep 2026" — a date alone, for lists and delivery estimates. */
export function formatDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: "medium",
    timeZone: SHOP_TIME_ZONE,
  }).format(new Date(iso));
}

/** "14:05" — the clock alone, for a "last checked" stamp. */
export function formatTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeStyle: "short",
    timeZone: SHOP_TIME_ZONE,
  }).format(new Date(iso));
}

/**
 * The delivery window an order is heading for: two to three days from the
 * moment payment was confirmed.
 *
 * Counted from confirmation rather than from when the order was placed,
 * because a manual bKash/Nagad transfer can sit unverified overnight and the
 * shop only starts packing once the money is checked. Returning null before
 * that point is deliberate — an estimate anchored to a clock that has not
 * started yet is a promise the shop has not made.
 */
export function deliveryWindow(confirmedAtIso: string): { from: Date; to: Date } {
  const confirmed = new Date(confirmedAtIso);

  return {
    from: addDays(confirmed, 2),
    to: addDays(confirmed, 3),
  };
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
