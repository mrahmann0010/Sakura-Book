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
