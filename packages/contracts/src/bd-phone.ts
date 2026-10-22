/**
 * A Bangladeshi mobile number in the local 11-digit form, `01XXXXXXXXX`, or
 * null when the input is not one.
 *
 * This is the form the payment gateway wants for `senderPhone`: it is what
 * bKash and Nagad print in their SMS, and what staff compare against a
 * customer's screenshot. Input is accepted loosely — spaces, dashes,
 * brackets, Bangla digits, and a `+880` / `880` / `00880` prefix — and then
 * held to the operator codes 013–019, which catches typos like `0121…`.
 */
export function normaliseBdPhone(input: string): string | null {
  let digits = toLatinDigits(input).replace(/\D/g, "");

  if (digits.startsWith("00880")) digits = digits.slice(2);
  if (digits.startsWith("880")) digits = `0${digits.slice(3)}`;

  return /^01[3-9]\d{8}$/.test(digits) ? digits : null;
}

/** ০–৯ → 0–9. Customers on a Bangla keyboard type these. */
function toLatinDigits(input: string): string {
  return input.replace(/[০-৯]/g, (digit) => String(digit.charCodeAt(0) - 0x09e6));
}
