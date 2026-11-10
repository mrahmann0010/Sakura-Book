import type { ReactNode } from "react";

import bn from "@/i18n/locales/bn/common.json";
import en from "@/i18n/locales/en/common.json";
import ja from "@/i18n/locales/ja/common.json";

/** The metadata flags the references draw. At most one shows on a card. */
export type BookFlag = "editors-pick" | "last-copy" | "signed" | "new" | "coming-soon" | "pre-order";

/**
 * The badge words, per locale, read straight out of the translation files.
 *
 * A plain lookup rather than `useTranslation` or `getTranslation`, because
 * `BookCard` takes its locale as a prop precisely so it can render inside a
 * server component without a client i18n context, and `getTranslation` is
 * async so a sync component cannot call it. The strings still live in
 * `src/i18n/locales/<locale>/common.json` under `book.flags`, so there is one source
 * of truth and a translator edits them in the same place as everything else.
 */
const flagTables = { en: en.book.flags, bn: bn.book.flags, ja: ja.book.flags } as const;

export function flagLabels(locale: string): Record<BookFlag, string> {
  const table = flagTables[locale as keyof typeof flagTables] ?? flagTables.bn;
  return table as Record<BookFlag, string>;
}

const bookTables = { en: en.book, bn: bn.book, ja: ja.book } as const;

/**
 * The handful of words a card prints beside the badge — the stand-in for a
 * price, and the shortened ships-around note. Same sync lookup, same reason.
 */
export function cardCopy(locale: string) {
  const book = bookTables[locale as keyof typeof bookTables] ?? bookTables.bn;
  return {
    outOfStock: book.stock.out,
    comingSoon: book.stock.comingSoon,
    shipsAround: (date: string) => book.shipsAroundShort.replace("{{date}}", date),
  };
}

/**
 * The shape every book-shaped component reads. Deliberately the smallest set
 * that renders a card, a cart line and an order line — anything richer (blurb,
 * ISBN, page count) belongs to the detail page, not to a reusable card.
 *
 * `priceCents` is an integer of minor units, matching the API — never a
 * formatted string. The string version was the older shape and it was wrong in
 * a way that showed: `catalog.ts` had to parse the number back out of it to
 * sort by price, which is what a display value being asked to do arithmetic
 * always looks like. Formatting is the render step's job, and it needs the
 * locale, which a data file does not have.
 */
export type BookSummary = {
  id: string;
  title: string;
  author: string;
  /** Minor units (paisa), as the API sends them. Format with `formatMoney`. */
  priceCents: number;
  /** Where the card links. Omit for a card that is not a link. */
  href?: string;
  coverUrl?: string;
  flag?: BookFlag;
  /** Sold-out cards drop to 55% and trade the price for the words. */
  soldOut?: boolean;
  /**
   * Mean score out of 5, and how many ratings stand behind it. Rendered as
   * words — "4.4 · 128 ratings" — never as stars: §1.03 wants state stated,
   * and §2 has no colour to spend on a glyph scale.
   */
  rating?: number;
  ratingCount?: number;
  /** "Paperback", "Hardback" — shown on cart lines beside the author. */
  format?: ReactNode;
  /** ISO date, present when `flag` is "pre-order" — the "ships around" note. */
  expectedShipDate?: string;
};
