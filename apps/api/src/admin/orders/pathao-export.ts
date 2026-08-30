import { bdDivisions } from "@sakura/contracts";
import type { ShippingAddress } from "../../db/schema";
import { toLatin, withLatinDigits } from "./bangla-latin";

/* --------------------------------------------------------------------------
   The Pathao bulk-order CSV.

   Pathao's merchant panel accepts a spreadsheet of parcels instead of the
   one-at-a-time form, and this renders exactly that file for a filtered set of
   accepted orders. The columns below are their template's, verbatim — headers,
   order, and the `(*)` suffixes that mark their required fields. They are
   matched by name on import, so this list is not ours to tidy: renaming
   `RecipientName(*)` to `Recipient name` produces a file Pathao rejects with
   no useful message.

   Why the whole file is built here rather than in the browser: the export must
   cover every order matching the filters, and the queue endpoint hands out
   twenty-five rows at a time with no street address on them at all (see
   adminOrderSummarySchema — a fifty-row table has no use for one). Paging the
   panel through the list to reassemble a manifest would be slower, and would
   silently produce a short file the day a page fails.

   ## What this file cannot know

   `RecipientZone(*)` is a name from Pathao's own zone list, and nothing in an
   order carries one — checkout collects division, district and free text (see
   bd-geo.ts on why upazila stayed free text). So the zone here is *read out of
   the address*, which is a guess and is documented as one on the screen that
   offers the download. A wrong zone is a row Pathao's importer rejects, which
   is the failure worth having: the operator fixes it in the sheet before the
   parcel exists. Silently shipping to a plausible-but-wrong zone would not be.
   -------------------------------------------------------------------------- */

/**
 * One order, reduced to the columns a courier manifest needs.
 *
 * The recipient's name and phone come off the order's own columns rather than
 * the frozen address, because that is where they live: `shipping_address` is
 * deliberately the three fields that are *not* columns on `orders`, so that an
 * indexed value has no second copy to disagree with (see ShippingAddress).
 */
export type PathaoExportRow = {
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  shippingAddress: ShippingAddress;
  paymentMethod: string;
  totalCents: number;
  customerNote: string | null;
  itemCount: number;
};

const CSV_COLUMNS = [
  "ItemType",
  "StoreName",
  "MerchantOrderId",
  "RecipientName(*)",
  "RecipientPhone(*)",
  "RecipientAddress(*)",
  "RecipientCity(*)",
  "RecipientZone(*)",
  "RecipientArea",
  "AmountToCollect(*)",
  "ItemQuantity",
  "ItemWeight",
  "ItemDesc",
  "SpecialInstruction",
] as const;

/**
 * Every parcel in this shop is a book order, and every book order is a
 * `parcel` in Pathao's vocabulary — the alternative, `document`, is for papers
 * and is priced differently.
 */
const ITEM_TYPE = "parcel";

/**
 * Weight in kilograms, as Pathao's template expects it — 250g is a paperback
 * with packaging, and it is what this shop ships.
 *
 * A flat figure rather than a computed one because nothing in the catalogue
 * records a book's weight; inventing a per-title number from the page count
 * would be a guess dressed up as data. Pathao re-weighs at pickup and bills on
 * what they measure, so an understated figure here costs nothing but a
 * corrected invoice — which is the right way round for a value we do not know.
 */
const ITEM_WEIGHT_KG = "0.25";

/**
 * One cell, quoted only when it has to be.
 *
 * Deliberately not the waitlist export's quote-everything rule. This file is
 * read by Pathao's importer rather than by a person in Excel, and their own
 * template quotes only the fields that contain a comma — so this matches it
 * rather than handing a machine parser a shape their sample never takes.
 *
 * The leading apostrophe on a formula-looking cell is kept, for the same
 * reason the waitlist export keeps it: an address is typed by a member of the
 * public, this file gets opened in a spreadsheet on the way to being uploaded,
 * and `=cmd|...` in a cell is executed there. Quoting is forced alongside it,
 * since the guard is only meaningful if the cell survives the round trip.
 */
function cell(value: string | number | null | undefined): string {
  /* Romanised here, at the one place every value in the file passes through,
     rather than at each of the six call sites that can carry Bangla. A field
     added later is covered by construction instead of by remembering — and the
     failure this guards is invisible from our side, since the mojibake only
     appears once the file is inside Pathao's system. Latin text, digits and
     punctuation come back unchanged, so the header and the numeric columns are
     untouched by it. */
  const text = value === null || value === undefined ? "" : toLatin(String(value));
  const dangerous = /^[=+\-@\t\r]/.test(text);
  const guarded = dangerous ? `'${text}` : text;

  if (!dangerous && !/[",\r\n]/.test(guarded)) return guarded;

  return `"${guarded.replace(/"/g, '""')}"`;
}

/** `Cox's Bazar` is a district name and a regex, so it is escaped before use. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Collapse the newlines and runs of spaces a textarea leaves behind. */
function tidy(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/* Bengali digits are converted before the address is read, not only on the way
   out: a postcode written `৩৫০০` has to be recognised as a postcode by
   `withoutPostcode`, and `\d` does not match it. See bangla-latin.ts. */

/**
 * The recipient's number in the local 11-digit form Pathao requires.
 *
 * Neither checkout nor the order schema normalises phone format — see the note
 * in OrdersService.lookup — so `+880 1711-111111`, `8801711111111` and
 * `01711 111111` are all real stored values for one number, and Pathao accepts
 * exactly one of those shapes.
 *
 * Anything that does not resolve to a Bangladeshi mobile comes back as its
 * bare digits rather than as an empty cell: the operator can see and fix a
 * wrong-looking number in the sheet, and cannot fix one that vanished.
 */
export function recipientPhone(raw: string): string {
  const digits = withLatinDigits(raw).replace(/\D/g, "");
  // Bangladeshi mobiles are 01[3-9]XXXXXXXX, so a leading 880 is always the
  // country code and never the start of a local number.
  const local = digits.replace(/^(?:00)?880/, "");

  if (/^1[3-9]\d{8}$/.test(local)) return `0${local}`;
  if (/^01[3-9]\d{8}$/.test(local)) return local;

  return digits;
}

/**
 * The address as the courier needs to read it: what the customer typed, plus
 * the district when they did not repeat it themselves.
 *
 * `RecipientCity(*)` carries the district too, but a rider reads the address
 * line — and half of these are typed without the district because the form
 * asked for it separately. Appending it only when it is genuinely absent keeps
 * "…, Uttara, Dhaka" from becoming "…, Uttara, Dhaka, Dhaka".
 *
 * The delivery region (`inside-dhaka`) is deliberately not appended: it is a
 * pricing zone from the shipping table, not a place, and printing it on a
 * parcel would be noise at best.
 */
export function recipientAddress(shipping: ShippingAddress): string {
  const address = tidy(withLatinDigits(shipping.address));
  const city = tidy(shipping.city);

  if (!city) return address;
  if (new RegExp(`\\b${escapeRegExp(city)}\\b`, "i").test(address)) return address;

  return address ? `${address}, ${city}` : city;
}

/**
 * House, road, sector, block, flat, floor — the tokens that make up the front
 * of a Bangladeshi address, abbreviated as people actually write them
 * ("H-1", "R#12", "Sec 6", "Flat 4B").
 *
 * Matched so the zone guess can skip past them. Note what has to follow the
 * token: a number, or a lone letter for the "Block C" and "Flat 4B" case. That
 * requirement is what keeps this from swallowing "Rampura" on its `R`, and
 * what leaves "Mirpur 1" — a real Pathao zone with a number in it — alone,
 * since "Mirpur" is not one of these tokens in the first place.
 */
const ADDRESS_PART =
  /^(h|ho|hs|house|r|rd|road|s|sec|sector|b|blk|block|fl|flat|flr|floor|apt|apartment|lane|ln|plot|holding)\b[\s.#/-]*(?:\d|[a-z]\b)/i;

/**
 * A sector or a block, in the spelling Pathao's own list uses.
 *
 * Anchored at both ends so only a part that is *entirely* a sector or block
 * qualifies: "S-6" is one, "Sector 6 main road" is a road that mentions one.
 * The abbreviation is expanded because "S-6" is how a customer writes it and
 * "Sector 6" is how Pathao stores it, and the two do not match as strings.
 */
const SECTOR = /^(?:s|sec|sector)\b[\s.#/-]*(\d{1,2})$/i;
const BLOCK = /^(?:b|blk|block)\b[\s.#/-]*([a-z0-9]{1,2})$/i;

/**
 * The eight division names, lower-cased.
 *
 * A division is never a Pathao zone, and people finish an address with one:
 * "…, Tangibari Munshiganj, Dhaka 1520" is a Munshiganj parcel whose last line
 * says which end of the country it is in. Read naively that made `Dhaka 1520`
 * the zone — a real row this shop exported, and one Pathao would refuse.
 *
 * Only wrong when a division name is also the locality, and that case is
 * already handled: the address's own district is skipped a line above, and
 * for "Dhaka, Dhaka" the two are the same word.
 */
const DIVISION_NAMES = new Set(bdDivisions.map((division) => division.label.toLowerCase()));

/**
 * Drop a trailing four-digit postcode.
 *
 * Bangladeshi postcodes are four digits and get written on the end of the last
 * line. Four specifically, not any number: "Mirpur 1" and "Sector 10" are
 * place names ending in a digit and must survive this untouched.
 */
function withoutPostcode(part: string): string {
  return tidy(withLatinDigits(part).replace(/\b\d{4}\b\s*$/, ""));
}

/**
 * Where the parcel is going, at the two levels below the district.
 *
 * Pathao nests City → Zone → Area — "Dhaka → Uttara → Sector 6" — and an order
 * carries neither of the lower two: checkout collects a district and one line
 * of free text (see bd-geo.ts on why upazila stayed free text). So both are
 * read out of the address, and both are guesses.
 *
 * Derived together, in one pass, rather than by two functions that each split
 * the address for themselves. The area is only meaningful relative to the zone
 * it sits in, and two independent walks could return a sector belonging to a
 * locality the zone column does not name.
 *
 * How it reads an address. People write "H-1, R-1, S-6, Uttara" — the locality
 * comes last, after the house and road that only mean something once you are
 * there. So the zone is the last part that is none of: the district repeated,
 * a division name, or a house/road token. The area is then whichever *other*
 * part is a sector or block, searched from the end and in either order,
 * because "Uttara, Sector 10" and "Sector 10, Uttara" are both things people
 * type.
 *
 * Postcodes come off every part before any of that, and the district comes off
 * the end of whichever part wins. Both are what a real exported row needed:
 * "…, Tangibari Munshiganj, Dhaka 1520" has to reach Pathao as `Tangibari`,
 * and read literally it arrived as `Dhaka 1520`.
 *
 * Either may come back empty, which is honest rather than unhelpful: an
 * address typed as one unpunctuated line genuinely does not say which zone it
 * is in, and most of the country is not organised into sectors at all. A blank
 * cell is the one an operator can see and fill.
 */
export function recipientPlace(shipping: ShippingAddress): { zone: string; area: string } {
  const city = tidy(shipping.city);
  const parts = shipping.address.split(",").map(withoutPostcode).filter(Boolean);

  let zoneIndex = -1;
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index].toLowerCase();

    if (part === city.toLowerCase()) continue;
    if (DIVISION_NAMES.has(part)) continue;
    if (ADDRESS_PART.test(part)) continue;

    zoneIndex = index;
    break;
  }

  let area = "";
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (index === zoneIndex) continue;

    const sector = SECTOR.exec(parts[index]);
    if (sector) {
      area = `Sector ${sector[1]}`;
      break;
    }

    const block = BLOCK.exec(parts[index]);
    if (block) {
      area = `Block ${block[1].toUpperCase()}`;
      break;
    }
  }

  if (zoneIndex === -1) return { zone: "", area };

  /* "Tangibari Munshiganj" is an upazila with its district written after it,
     and Pathao's zone is the upazila alone. Trimmed only from the end, so a
     zone that merely opens with the district ("Munshiganj Sadar") keeps its
     name — and only when something is left, since a part that *is* the
     district was skipped above rather than trimmed to nothing. */
  const zone = tidy(
    parts[zoneIndex].replace(new RegExp(`[\\s,-]*\\b${escapeRegExp(city)}\\b\\s*$`, "i"), ""),
  );

  return { zone: zone || parts[zoneIndex], area };
}

/**
 * What the rider collects at the door, in taka.
 *
 * Zero for anything already paid: a manual transfer that reached this list has
 * been confirmed by a member of staff, and asking Pathao to collect its total
 * again would charge the customer twice. Only cash on delivery carries a
 * figure, and it is the order total — delivery included, because the customer
 * was quoted one number and that is the number they are expecting to hand over.
 *
 * Rounded to whole taka: amounts are stored in minor units and Pathao collects
 * cash, which does not come in poisha.
 */
export function amountToCollect(row: PathaoExportRow): number {
  if (row.paymentMethod !== "cash-on-delivery") return 0;

  return Math.round(row.totalCents / 100);
}

/**
 * The rows as Pathao's importer wants them.
 *
 * `storeName` is passed in rather than hard-coded because it has to match the
 * store registered on the merchant's Pathao account character for character,
 * and that is an operational fact about an external account — see
 * PATHAO_STORE_NAME in env.schema.ts.
 *
 * CRLF, and no BOM — and this is the third position this file has taken on
 * that, so the history is worth keeping.
 *
 * It shipped without one, because a leading U+FEFF makes the first column
 * something other than `ItemType` to a parser that does not strip it, and a
 * header Pathao cannot match rejects the whole upload. Bangla then arrived in
 * their panel as `à¦¹à¦¾à¦¸...` — UTF-8 read a byte at a time as Latin-1 — so
 * the mark went in, on the reasoning that a retryable header failure beats
 * unreadable addresses. It made no difference: their importer reads Latin-1
 * whatever we send.
 *
 * That settled it in the other direction. Every cell is romanised on the way
 * out now (see `cell`), which makes the whole file ASCII — the one encoding
 * every reader agrees on, byte for byte. There is nothing left for a BOM to
 * declare, so it comes back out rather than sitting there costing header risk
 * for a problem that no longer exists.
 */
export function toPathaoCsv(rows: PathaoExportRow[], storeName: string): string {
  const lines = [CSV_COLUMNS.map((column) => cell(column)).join(",")];

  for (const row of rows) {
    const shipping = row.shippingAddress;
    const place = recipientPlace(shipping);

    lines.push(
      [
        cell(ITEM_TYPE),
        cell(storeName),
        cell(row.orderNumber),
        cell(tidy(row.customerName)),
        cell(recipientPhone(row.customerPhone)),
        cell(recipientAddress(shipping)),
        cell(tidy(shipping.city)),
        cell(place.zone),
        /* Optional in Pathao's template — it is the only geography column they
           do not mark required — and filled anyway wherever the address says
           enough to fill it. A sector or block that is right saves the
           operator a lookup; one that is wrong is a row their importer refuses
           and a cell to correct in the sheet, which is the same handling a
           wrong zone already gets. */
        cell(place.area),
        cell(amountToCollect(row)),
        cell(row.itemCount),
        cell(ITEM_WEIGHT_KG),
        /* ItemDesc is optional, and what would go in it is book titles. A
           courier manifest is handled by people outside the shop and passes
           through a third party's system; what is in the parcel is not their
           business, and the order number above is enough to trace it. */
        cell(""),
        cell(row.customerNote ? tidy(row.customerNote) : ""),
      ].join(","),
    );
  }

  return `${lines.join("\r\n")}\r\n`;
}
