/**
 * A transaction ID as the customer meant it, without the label they copied
 * along with it.
 *
 * Customers often paste or type the label from the bKash/Nagad/Rocket SMS
 * together with the ID: `TrxID ABC1234XYZ`, `TxnID: 7A1B2C3D`,
 * `Transaction ID - 1234567890`, or the Bangla `ট্রানজেকশন আইডি: …`. Kept as
 * typed, the label becomes part of the receipt (`TRXIDABC1234XYZ`) and the
 * gateway never finds a match, so the order is left pending.
 *
 * This removes one leading label and any punctuation or non-Latin text
 * around the ID. It does not touch the ID's characters, so a typing mistake
 * still needs staff to correct it.
 *
 * A label is only removed when it is a whole word: "TRX" on its own must be
 * followed by a separator, but "TRXID", "TRX ID", "TXN NO" and so on are
 * removed even when the ID follows with no space. Real bKash, Nagad and
 * Rocket IDs do not start with these words.
 *
 * Returns "" when nothing is left, which checkout reports as a missing ID.
 */
export function cleanTransactionId(input: string): string {
  let value = toLatinDigits(input).trim();

  // Anything before the first Latin letter or digit: a Bangla label, quotes, "#", ":".
  value = value.replace(LEADING_JUNK, "");

  const labelled = LABEL_WITH_SUFFIX.exec(value) ?? LABEL_WITH_SEPARATOR.exec(value);
  if (labelled) value = value.slice(labelled[0].length);

  return value.replace(LEADING_JUNK, "").replace(TRAILING_JUNK, "");
}

/** "TrxID", "Trx ID", "TxnID", "Trans. ID", "Transaction No", followed by anything. */
const LABEL_WITH_SUFFIX =
  /^(?:trx|txn|trnx|tran|trans|transaction)[\s._-]*(?:id|no|number)[\s:#=._-]*/i;

/** "Trx: …", "TXN - …": the bare word, only when a separator follows it. */
const LABEL_WITH_SEPARATOR = /^(?:trx|txn|trnx|transaction)[\s]*[:#=-][\s:#=-]*/i;

const LEADING_JUNK = /^[^A-Za-z0-9]+/;
const TRAILING_JUNK = /[^A-Za-z0-9]+$/;

/** ০–৯ → 0–9. Customers on a Bangla keyboard type these. */
function toLatinDigits(input: string): string {
  return input.replace(/[০-৯]/g, (digit) => String(digit.charCodeAt(0) - 0x09e6));
}
