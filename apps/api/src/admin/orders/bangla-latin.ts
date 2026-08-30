/* --------------------------------------------------------------------------
   Bengali script → Latin letters.

   Written for the Pathao export and used nowhere else, which is why it lives
   here rather than in a utilities package. It exists because that file has to
   survive a trip through someone else's CSV importer, and two independent
   things go wrong when Bangla makes that trip:

   - Their importer reads the bytes as Latin-1 whatever we send. A UTF-8 BOM
     was tried and changed nothing, so "হাসপাতাল" arrives as "à¦¹à¦¾à¦¸...".
   - `RecipientZone` is matched against Pathao's own list of zones, and that
     list is in English. A Bangla locality could not match it even if every
     byte survived intact.

   Romanised output solves both at once, and solves them permanently: ASCII is
   the one thing every encoding agrees on. Romanised Bangla is also read
   without difficulty by the people this file is written for — it is how half
   the country types on a phone.

   What this is not: a scholarly transliteration. There is no attempt at ISO
   15919's diacritics, because a rider reading "Gandirpar" off a phone is the
   entire success condition and "Gāndirpāṛ" serves that no better. Nor does it
   model Bangla's schwa deletion beyond the one rule that matters visibly (see
   the inherent vowel, below).
   -------------------------------------------------------------------------- */

/** Independent vowels — the forms written at the start of a syllable. */
const VOWELS: Record<string, string> = {
  অ: "o",
  আ: "a",
  ই: "i",
  ঈ: "i",
  উ: "u",
  ঊ: "u",
  ঋ: "ri",
  এ: "e",
  ঐ: "oi",
  ও: "o",
  ঔ: "ou",
};

/**
 * Vowel signs — the same vowels as marks hung on a consonant.
 *
 * Kept separate from the independent forms above because they behave
 * differently: a sign replaces the consonant's inherent vowel rather than
 * standing on its own.
 */
const SIGNS: Record<string, string> = {
  "া": "a", // া
  "ি": "i", // ি
  "ী": "i", // ী
  "ু": "u", // ু
  "ূ": "u", // ূ
  "ৃ": "ri", // ৃ
  "ে": "e", // ে
  "ৈ": "oi", // ৈ
  "ো": "o", // ো
  "ৌ": "ou", // ৌ
};

/**
 * Consonants, each carrying an inherent "a" that the caller adds or suppresses.
 *
 * The aspirated/unaspirated and dental/retroflex pairs collapse together — ত
 * and ট are both "t" — because Latin has no letters for the distinction and
 * inventing one ("tt", "T") produces something nobody reads faster.
 */
const CONSONANTS: Record<string, string> = {
  ক: "k",
  খ: "kh",
  গ: "g",
  ঘ: "gh",
  ঙ: "ng",
  চ: "ch",
  ছ: "chh",
  জ: "j",
  ঝ: "jh",
  ঞ: "n",
  ট: "t",
  ঠ: "th",
  ড: "d",
  ঢ: "dh",
  ণ: "n",
  ত: "t",
  থ: "th",
  দ: "d",
  ধ: "dh",
  ন: "n",
  প: "p",
  ফ: "ph",
  ব: "b",
  ভ: "bh",
  ম: "m",
  য: "j",
  র: "r",
  ল: "l",
  শ: "sh",
  ষ: "sh",
  স: "s",
  হ: "h",
  "\u09DC": "r", // RA with nukta
  "\u09DD": "rh", // RHA with nukta
  "\u09DF": "y", // YYA with nukta
  ৎ: "t",
};

/** Marks that stand on their own rather than modifying a vowel. */
const MARKS: Record<string, string> = {
  "ং": "ng", // ং  anusvara
  "ঃ": "h", // ঃ  visarga
  "ঁ": "n", // ঁ  chandrabindu, the nasal in "chand"
  "়": "", // ়   nukta; compose() folds it in, this catches strays
};

/** ্ — suppresses the preceding consonant's inherent vowel, joining a cluster. */
const VIRAMA = "্";

/** ০ is U+09E6, and the ten digits run consecutively from there. */
const BENGALI_ZERO = 0x09e6;

/**
 * Bengali digits to Latin ones.
 *
 * Separate from the letters because it is needed on its own: a phone number
 * typed as `০১৭১১...` has to become digits before anything can normalise it,
 * and a postcode written `৩৫০০` has to become digits before it can be
 * recognised as a postcode. `\d` matches neither.
 */
export function withLatinDigits(value: string): string {
  return value.replace(/[০-৯]/g, (digit) => String(digit.charCodeAt(0) - BENGALI_ZERO));
}

/**
 * Bangla text in Latin letters. Anything already Latin passes through
 * untouched, so a mixed address ("গৌতুয়ালি Cumilla") romanises only the half
 * that needs it.
 *
 * ## The inherent vowel
 *
 * Every Bengali consonant carries an unwritten "a" unless a vowel sign or a
 * virama says otherwise. Emitting it everywhere gives "gandirapara"; Bangla
 * drops it at the end of a word, which is why the name is "Gandirpar". So the
 * "a" is added only when another Bengali letter follows — mid-word — and never
 * before a space, a comma or the end of the string.
 *
 * That is one rule where the language has several, and it is deliberate: the
 * remaining cases produce a spelling slightly longer than a native speaker
 * would write, which costs nothing, where getting the word-final case wrong is
 * visible in every single address.
 */
export function toLatin(text: string): string {
  const source = withLatinDigits(compose(text.normalize("NFC")));

  let out = "";

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const consonant = CONSONANTS[character];

    if (consonant !== undefined) {
      out += consonant;

      const next = source[index + 1];

      // A cluster: the consonants run together with no vowel between them.
      if (next === VIRAMA) {
        index += 1;
        continue;
      }

      const sign = next === undefined ? undefined : SIGNS[next];
      if (sign !== undefined) {
        out += sign;
        index += 1;
        continue;
      }

      // The inherent vowel, mid-word only — see above.
      if (next !== undefined && isBengaliLetter(next)) out += "a";
      continue;
    }

    const vowel = VOWELS[character];
    if (vowel !== undefined) {
      out += vowel;
      continue;
    }

    /* A vowel sign reached here has no consonant in front of it — malformed
       input, or a sign the writer typed alone. Rendered rather than dropped,
       since it is still a sound the reader needs. */
    const stray = SIGNS[character];
    if (stray !== undefined) {
      out += stray;
      continue;
    }

    const mark = MARKS[character];
    if (mark !== undefined) {
      out += mark;
      continue;
    }

    // A stray virama, with no consonant to attach to. Silent.
    if (character === VIRAMA) continue;

    // Latin letters, digits, punctuation and spaces, unchanged.
    out += character;
  }

  return out;
}

/**
 * Fold ড + ়, ঢ + ় and য + ় into the single characters ড়, ঢ় and য়.
 *
 * `normalize("NFC")` does not do this and never will: all three are on
 * Unicode's composition exclusion list, so NFC leaves a nukta sequence
 * decomposed. Both spellings come out of real keyboards, and without this the
 * two halves are read separately — "পাড়" ends in a `d` with a silent mark
 * after it rather than the `r` a reader expects, which is a wrong street name
 * rather than an odd-looking one.
 */
function compose(text: string): string {
  /* Written as the decomposed sequence on the left and the single character
     on the right. The two are indistinguishable on screen, so this reads as a
     no-op unless you look at the bytes -- it is not one. */
  return text.replace(/ড়/g, "ড়").replace(/ঢ়/g, "ঢ়").replace(/য়/g, "য়");
}

/** Whether a following character continues the word, for the inherent vowel. */
function isBengaliLetter(character: string): boolean {
  return (
    CONSONANTS[character] !== undefined ||
    VOWELS[character] !== undefined ||
    SIGNS[character] !== undefined ||
    character === VIRAMA
  );
}
