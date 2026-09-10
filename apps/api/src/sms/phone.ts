import { withLatinDigits } from "../common/bangla-latin";

/**
 * A phone number in the `+8801XXXXXXXXX` form the SMS gateway requires.
 *
 * Nothing normalises phone format on the way in — checkout and the waitlist
 * form both store what was typed — so `01711111111`, `01711-111111`,
 * `+880 1711-111111` and `৮৮০১৭১১১১১১১১` are all real stored values for one
 * number, and the gateway answers everything but E.164 with `400 invalid
 * phone number`. Normalising at the one place that talks to the gateway is
 * what keeps the invite batch and the admin send panel from disagreeing.
 *
 * A number that does not resolve to a Bangladeshi mobile comes back trimmed
 * but otherwise untouched, for the gateway to reject: an invite SMS carries a
 * redeemable claim on stock, so a visible failure in the admin table is a far
 * better outcome than a guess that texts the link to whoever happens to own
 * the number the guess produced.
 */
export function toE164Bd(raw: string): string {
  const trimmed = withLatinDigits(raw).trim();
  // Separators are noise the gateway will not take: `+880 1711-111111` and
  // `01711111111` have to reach the same place.
  const digits = trimmed.replace(/\D/g, "");

  // Bangladeshi mobiles are 01[3-9] + 8 digits, so a leading 880 (however it
  // was dialled) is always the country code and never part of the number, and
  // the remaining leading 0 is the domestic trunk prefix.
  const local = digits.replace(/^(?:00)?880/, "").replace(/^0/, "");

  return /^1[3-9]\d{8}$/.test(local) ? `+880${local}` : trimmed;
}
