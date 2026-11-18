import type { Locale } from "@/i18n/settings";

/* --------------------------------------------------------------------------
   Search-intent copy for the pages that actually carry organic traffic:
   the home page (brand + category search) and the catalog (JLPT/JFT/NAT
   level and skill search). Kept separate from the on-page <h1> copy in
   i18n/locales/*, which is written to read naturally to a person — these
   strings are written to match what a Bangladeshi learner actually types
   into Google, in the language they type it in (Bangla for `bn`, the
   default locale; English for `en`). `ja` falls back to the English copy —
   the shop has no Japanese-market content strategy, and machine-translating
   marketing copy into Japanese would read as worse than English to a native
   reader.
   -------------------------------------------------------------------------- */

interface SeoCopy {
  title: string;
  description: string;
}

function forLocale(locale: Locale, bn: SeoCopy, en: SeoCopy): SeoCopy {
  return locale === "bn" ? bn : en;
}

export function siteDefaultSeo(locale: Locale): SeoCopy {
  return forLocale(
    locale,
    {
      title: "Nihonova Books — বাংলায় জাপানি ভাষা শেখার JLPT বই",
      description:
        "JLPT N5 থেকে N1, JFT-Basic ও NAT Test প্রস্তুতির জন্য বাংলায় লেখা গ্রামার, কাঞ্জি ও ভোকাবুলারি বই। সারা বাংলাদেশে হোম ডেলিভারি, bKash/Rocket/Nagad পেমেন্ট।",
    },
    {
      title: "Nihonova Books — JLPT Preparation Books in Bangla",
      description:
        "Grammar, Kanji and Vocabulary books for JLPT N5–N1, JFT-Basic and NAT Test, written in Bangla for Bangladeshi learners. Nationwide delivery, bKash/Rocket/Nagad payment.",
    },
  );
}

export function catalogSeo(locale: Locale): SeoCopy {
  return forLocale(
    locale,
    {
      title: "JLPT N5–N1 বই — গ্রামার, কাঞ্জি, ভোকাবুলারি",
      description:
        "JLPT, JFT-Basic ও NAT Test প্রস্তুতির জন্য লেভেল অনুযায়ী (N5–N1) গ্রামার, কাঞ্জি, ভোকাবুলারি বই কিনুন — বাংলায় লেখা, বাংলাদেশজুড়ে হোম ডেলিভারি ও bKash/Rocket/Nagad পেমেন্ট সুবিধাসহ।",
    },
    {
      title: "JLPT N5–N1 Books — Grammar, Kanji & Vocabulary",
      description:
        "Shop JLPT, JFT-Basic and NAT Test preparation books by level (N5–N1) — grammar, kanji and vocabulary, written in Bangla, with nationwide Bangladesh delivery and bKash/Rocket/Nagad payment.",
    },
  );
}

/* --------------------------------------------------------------------------
   Everything below was added by the SEO pass documented in apps/web/SEO/.
   -------------------------------------------------------------------------- */

/**
 * A meta description cut to length without cutting a word in half.
 *
 * The book page used to do `book.description.slice(0, 160)`, which on the
 * live site produced "…একটি Kanji-এ" — a sentence stopped mid-syllable, in the
 * one piece of copy a searcher reads before deciding whether to click. It also
 * passed the description's paragraph breaks straight into a meta attribute,
 * where they are whitespace Google collapses anyway.
 *
 * 155 rather than 160: Google measures the rendered snippet in pixels, not
 * characters, and truncates with an ellipsis of its own. Leaving a few
 * characters of headroom means our ellipsis is the only one.
 */
export function metaDescription(text: string, max = 155): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;

  /* Cut at the last space inside the budget, so the snippet ends on a whole
     word. Bangla is written with spaces between words exactly as English is,
     so one rule serves both locales; if a locale without word spaces is ever
     added (Japanese prose, say) this needs a segmenter, not a longer slice. */
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:।\-–—]$/, "")}…`;
}

/** The two category groups the shop actually sells across — see the seed in
    apps/api/src/db/seed/reset-and-seed-jlpt.ts. */
export const LEVEL_GROUP = "level";
export const SKILL_GROUP = "skill";

type CategoryRef = { slug: string; name: string; group: string | null };

/**
 * The JLPT level and skill a book is filed under, as plain names.
 *
 * Both come from `book.categories`, which is staff-entered data — nothing here
 * invents a level a book was not tagged with. A book tagged with neither gets
 * `null` for both and the callers below fall back to the bare title.
 */
export function bookFacets(categories: CategoryRef[]) {
  return {
    level: categories.find((category) => category.group === LEVEL_GROUP)?.name ?? null,
    skill: categories.find((category) => category.group === SKILL_GROUP)?.name ?? null,
  };
}

/**
 * A book's <title>, with the search terms its own title may not contain.
 *
 * The live titles are editorial, not descriptive: the kanji book is called
 * "কাঞ্জি মুখস্থ নয়" ("not memorising kanji"), which is a good cover line and a
 * title tag carrying none of "JLPT", "N5" or "kanji" — the words a learner
 * types. This appends the level and skill the book is *tagged* with, so the
 * title reads as both the book's name and what it is for.
 *
 * The brand suffix is left to the layout's title template, which already adds
 * "· Nihonova Books".
 */
export function bookSeoTitle(
  title: string,
  categories: CategoryRef[],
  locale: Locale,
): string {
  const { level, skill } = bookFacets(categories);
  if (!level && !skill) return title;

  /* "JLPT N5 কাঞ্জি বই" / "JLPT N5 Kanji Book" — level and skill are already
     Latin-script proper nouns in every locale ("N5", "Kanji"), so only the
     word "book" is translated. */
  const qualifier = [level ? `JLPT ${level}` : null, skill].filter(Boolean).join(" ");
  const noun = locale === "bn" ? "বই" : locale === "ja" ? "参考書" : "Book";

  return `${title} — ${qualifier} ${noun}`;
}

/* --------------------------------------------------------------------------
   Category (facet) landing pages.

   `/catalog?genre=n5` is the shop's N5 shelf. There is no `/catalog/n5` route
   and there should not be: the filtered catalogue already renders exactly that
   shelf, and a second route rendering the same books from the same query would
   be two pages competing for one keyword — cannibalisation built in by hand.
   What was missing was not a URL, it was permission to index the one that
   already existed, plus copy of its own. Both live here.
   -------------------------------------------------------------------------- */

/**
 * The facets allowed to be indexed, and the copy each gets.
 *
 * A closed allowlist, deliberately, against the open `genres` the URL parser
 * accepts. `parseSearchParams` is lenient so a hand-edited link degrades to an
 * empty shelf instead of erroring — but an empty shelf that is *indexable* is
 * a thin page, and `?genre=anything` would mint an unbounded supply of them.
 * A slug not named here still filters the shelf for a visitor; it just does
 * not get a canonical of its own.
 *
 * The slugs mirror `categories.slug` in apps/api/src/db/seed/reset-and-seed-jlpt.ts.
 * A category added by staff is not indexable until it is added here, which is
 * the right default: whether a shelf is worth a landing page is an editorial
 * judgement, not a consequence of a row being inserted.
 */
const FACET_SEO: Record<string, { bn: SeoCopy; en: SeoCopy }> = {
  n5: {
    bn: {
      title: "JLPT N5 বই — বাংলায় জাপানি ভাষার প্রথম ধাপ",
      description:
        "JLPT N5 প্রস্তুতির জন্য বাংলায় লেখা বই — হিরাগানা, কাতাকানা, বেসিক কাঞ্জি, গ্রামার ও ভোকাবুলারি। নতুনদের জন্য উপযোগী, বাংলাদেশজুড়ে হোম ডেলিভারি।",
    },
    en: {
      title: "JLPT N5 Books — Start Japanese in Bangla",
      description:
        "JLPT N5 preparation books written in Bangla — hiragana, katakana, basic kanji, grammar and vocabulary for complete beginners. Delivered across Bangladesh.",
    },
  },
  n4: {
    bn: {
      title: "JLPT N4 বই — বাংলায় গ্রামার, কাঞ্জি ও ভোকাবুলারি",
      description:
        "JLPT N4 প্রস্তুতির জন্য বাংলায় লেখা বই — N5-এর পরের ধাপের গ্রামার, কাঞ্জি, ভোকাবুলারি ও লিসেনিং অনুশীলন। বাংলাদেশজুড়ে হোম ডেলিভারি।",
    },
    en: {
      title: "JLPT N4 Books — Grammar, Kanji & Vocabulary in Bangla",
      description:
        "JLPT N4 preparation books written in Bangla — the grammar, kanji, vocabulary and listening practice that follow N5. Delivered across Bangladesh.",
    },
  },
  n3: {
    bn: {
      title: "JLPT N3 বই — বাংলায় মধ্যম স্তরের জাপানি",
      description:
        "JLPT N3 প্রস্তুতির জন্য বাংলায় লেখা বই — মধ্যম স্তরের গ্রামার, কাঞ্জি ও ভোকাবুলারি। বাংলাদেশজুড়ে হোম ডেলিভারি, bKash/Rocket/Nagad পেমেন্ট।",
    },
    en: {
      title: "JLPT N3 Books — Intermediate Japanese in Bangla",
      description:
        "JLPT N3 preparation books written in Bangla — intermediate grammar, kanji and vocabulary. Delivered across Bangladesh with bKash/Rocket/Nagad payment.",
    },
  },
  n2: {
    bn: {
      title: "JLPT N2 বই — বাংলায় উচ্চ স্তরের জাপানি",
      description:
        "JLPT N2 প্রস্তুতির জন্য বাংলায় লেখা বই — উচ্চ স্তরের গ্রামার, কাঞ্জি, ভোকাবুলারি ও রিডিং। বাংলাদেশজুড়ে হোম ডেলিভারি।",
    },
    en: {
      title: "JLPT N2 Books — Upper-Intermediate Japanese in Bangla",
      description:
        "JLPT N2 preparation books written in Bangla — advanced grammar, kanji, vocabulary and reading. Delivered across Bangladesh.",
    },
  },
  n1: {
    bn: {
      title: "JLPT N1 বই — বাংলায় সর্বোচ্চ স্তরের জাপানি",
      description:
        "JLPT N1 প্রস্তুতির জন্য বাংলায় লেখা বই — সর্বোচ্চ স্তরের গ্রামার, কাঞ্জি, ভোকাবুলারি ও রিডিং। বাংলাদেশজুড়ে হোম ডেলিভারি।",
    },
    en: {
      title: "JLPT N1 Books — Advanced Japanese in Bangla",
      description:
        "JLPT N1 preparation books written in Bangla — the most advanced grammar, kanji, vocabulary and reading. Delivered across Bangladesh.",
    },
  },
  grammar: {
    bn: {
      title: "জাপানি ব্যাকরণ বই — বাংলায় JLPT গ্রামার",
      description:
        "জাপানি ব্যাকরণ বাংলায় বুঝে শেখার বই — JLPT N5 থেকে N1 পর্যন্ত গ্রামার প্যাটার্ন, উদাহরণ বাক্য ও অনুশীলন। বাংলাদেশজুড়ে হোম ডেলিভারি।",
    },
    en: {
      title: "Japanese Grammar Books — JLPT Grammar Explained in Bangla",
      description:
        "Japanese grammar books that explain every pattern in Bangla — JLPT N5 to N1 grammar points, example sentences and practice. Delivered across Bangladesh.",
    },
  },
  kanji: {
    bn: {
      title: "জাপানি কানজি শেখার বই — বাংলায় কাঞ্জি গাইড",
      description:
        "কাঞ্জি মুখস্থ না করে রেডিক্যাল ও অর্থ ধরে শেখার বই, বাংলায় ব্যাখ্যা সহ — JLPT N5 থেকে N1 পর্যন্ত। বাংলাদেশজুড়ে হোম ডেলিভারি।",
    },
    en: {
      title: "Japanese Kanji Books — Learn Kanji with Bangla Explanations",
      description:
        "Kanji books that teach radicals and meaning rather than rote memorisation, explained in Bangla — JLPT N5 to N1. Delivered across Bangladesh.",
    },
  },
  vocabulary: {
    bn: {
      title: "জাপানি শব্দভান্ডার বই — বাংলা অর্থসহ ভোকাবুলারি",
      description:
        "জাপানি শব্দের বাংলা অর্থ, উচ্চারণ ও উদাহরণ বাক্যসহ ভোকাবুলারি বই — JLPT N5 থেকে N1 পর্যন্ত। বাংলাদেশজুড়ে হোম ডেলিভারি।",
    },
    en: {
      title: "Japanese Vocabulary Books — Word Lists with Bangla Meanings",
      description:
        "Japanese vocabulary books with Bangla meanings, readings and example sentences — JLPT N5 to N1. Delivered across Bangladesh.",
    },
  },
  reading: {
    bn: {
      title: "জাপানি রিডিং বই — JLPT দোক্কাই অনুশীলন",
      description:
        "JLPT রিডিং (দোক্কাই) অনুশীলনের বই — প্যাসেজ, প্রশ্ন ও বাংলায় ব্যাখ্যা, N5 থেকে N1 পর্যন্ত। বাংলাদেশজুড়ে হোম ডেলিভারি।",
    },
    en: {
      title: "Japanese Reading Books — JLPT Dokkai Practice",
      description:
        "JLPT reading (dokkai) practice books — passages, questions and Bangla explanations, N5 to N1. Delivered across Bangladesh.",
    },
  },
  listening: {
    bn: {
      title: "জাপানি লিসেনিং বই — JLPT চোকাই অনুশীলন",
      description:
        "JLPT লিসেনিং (চোকাই) অনুশীলনের বই — অডিও স্ক্রিপ্ট, প্রশ্ন ও বাংলায় ব্যাখ্যা, N5 থেকে N1 পর্যন্ত। বাংলাদেশজুড়ে হোম ডেলিভারি।",
    },
    en: {
      title: "Japanese Listening Books — JLPT Choukai Practice",
      description:
        "JLPT listening (choukai) practice books — scripts, questions and Bangla explanations, N5 to N1. Delivered across Bangladesh.",
    },
  },
};

/** The facet slugs that have a landing page, in the order a shelf should list
    them: levels low to high, then skills. Drives the footer's crawl path. */
export const indexableFacets = Object.keys(FACET_SEO);

/** Copy for one facet's landing page. Mirrors `siteDefaultSeo`'s locale rule:
    Bangla for `bn`, English for `en` and `ja`. */
export function facetSeo(slug: string, locale: Locale): SeoCopy {
  const copy = FACET_SEO[slug];
  return forLocale(locale, copy.bn, copy.en);
}

/**
 * The one facet this view is a landing page for, or `null` if it is a slice.
 *
 * Exactly one category, no search term, page 1, and that category must be on
 * the allowlist above. Anything else is a combination — see the catalog's
 * `generateMetadata` for why combinations do not get canonicals.
 */
export function indexableFacet(query: {
  q: string;
  genres: string[];
  page: number;
}): string | null {
  if (query.q || query.page !== 1 || query.genres.length !== 1) return null;
  const [slug] = query.genres;
  return slug in FACET_SEO ? slug : null;
}
