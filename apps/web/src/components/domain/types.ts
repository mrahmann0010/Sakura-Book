import type { ReactNode } from "react";

/** The metadata flags the references draw. At most one shows on a card. */
export type BookFlag = "editors-pick" | "last-copy" | "signed";

export const flagLabels: Record<BookFlag, string> = {
  "editors-pick": "Editor's pick",
  "last-copy": "Last copy",
  signed: "Signed",
};

/**
 * The shape every book-shaped component reads. Deliberately the smallest set
 * that renders a card, a cart line and an order line — anything richer (blurb,
 * ISBN, page count) belongs to the detail page, not to a reusable card.
 *
 * `price` is a preformatted string: currency and locale are a data concern,
 * and no component should be guessing at either.
 */
export type BookSummary = {
  id: string;
  title: string;
  author: string;
  price: string;
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
};
