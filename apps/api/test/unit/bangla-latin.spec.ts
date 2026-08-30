import { describe, expect, it } from "vitest";
import { toLatin, withLatinDigits } from "../../src/admin/orders/bangla-latin";

/**
 * Bengali → Latin, for the Pathao export.
 *
 * The cases below are real addresses from the shop, including the two that
 * came back from Pathao's panel as mojibake. Worth pinning because the failure
 * is invisible from this side: a wrong letter here is a street name a rider
 * cannot find, and nothing in the app ever renders this output.
 */

describe("withLatinDigits", () => {
  it("converts a postcode written in Bengali numerals", () => {
    // `\d` does not match these, so a postcode left in this form is never
    // recognised as one and the division line wins the zone.
    expect(withLatinDigits("ঢাকা ১২১৫")).toBe("ঢাকা 1215");
  });

  it("converts a phone number typed on a Bangla keyboard", () => {
    // Otherwise the phone normaliser strips them as punctuation, and the cell
    // arrives empty.
    expect(withLatinDigits("০১৭১১১১১১১১")).toBe("01711111111");
  });

  it("leaves Latin digits alone", () => {
    expect(withLatinDigits("Sector 10")).toBe("Sector 10");
  });
});

describe("toLatin", () => {
  it.each([
    ["হাসপাতাল মাঠ", "hasapatal math"],
    ["রুমানা আক্তার", "rumana aktar"],
    ["গৌতুয়ালি", "goutuyali"],
    ["রামগাংলা", "ramagangla"],
    ["সেলুনের সামনে", "seluner samane"],
  ])("romanises %s", (bangla, latin) => {
    expect(toLatin(bangla)).toBe(latin);
  });

  it("drops the inherent vowel at the end of a word", () => {
    // Every consonant carries an unwritten "a"; Bangla drops it word-finally,
    // which is the difference between "Gandirpar" and "gandirapara".
    expect(toLatin("গান্দিরপাড়")).toBe("gandirapar");
  });

  it("reads a consonant cluster as one run, with no vowel between", () => {
    // ক্ত is a cluster: the virama suppresses the "a" that would sit inside it.
    expect(toLatin("আক্তার")).toBe("aktar");
  });

  it.each([
    ["পাড়", "par"],
    ["হুয়ার", "huyar"],
  ])("reads the nukta forms in %s as one letter", (bangla, latin) => {
    // ড় and য় are composition exclusions, so `normalize("NFC")` leaves the
    // decomposed spelling alone. Unhandled, "পাড়" ends in a `d` — a different
    // street — rather than the `r` a reader expects.
    expect(toLatin(bangla.normalize("NFD"))).toBe(latin);
    expect(toLatin(bangla.normalize("NFC"))).toBe(latin);
  });

  it("keeps the nasal a chandrabindu marks", () => {
    expect(toLatin("চাঁদপুর")).toBe("chandapur");
  });

  it("passes Latin text through untouched, so a mixed address romanises in half", () => {
    expect(toLatin("গৌতুয়ালি Cumilla, Chattogram ৩৫০০")).toBe(
      "goutuyali Cumilla, Chattogram 3500",
    );
  });

  it("leaves punctuation and spacing exactly where they were", () => {
    // The commas are what the zone logic splits an address on, so this is not
    // a cosmetic property.
    expect(toLatin("H-1, R-1, S-6, Uttara")).toBe("H-1, R-1, S-6, Uttara");
  });

  it("emits only ASCII, which is the whole point of it", () => {
    const romanised = toLatin("প্রদীপ হুয়ার পার্কিং সেলুনের সামনে");

    expect(romanised).toMatch(/^[\x20-\x7e]*$/);
  });
});
