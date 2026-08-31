import type { Review } from "@sakura/contracts";

/**
 * Row → wire shape, for the public read.
 *
 * Explicit rather than a spread, and that is the point — the same argument
 * book.mapper.ts makes, with sharper teeth here: `authorEmail`, `ipHash`,
 * `userAgent` and `moderatorNote` are all on the row, and every one of them is
 * either PII or a staff note. A column added to `initial_reviews` must not
 * reach a page because someone forgot this file exists.
 */

export type PublicReviewRow = {
  id: string;
  authorName: string | null;
  rating: number | null;
  title: string | null;
  body: string;
  isVerified: boolean;
  publishedAt: Date | null;
};

export function toReview(row: PublicReviewRow): Review {
  return {
    id: row.id,
    authorName: row.authorName,
    rating: row.rating,
    title: row.title,
    body: row.body,
    isVerified: row.isVerified,
    /*
     * Non-null by construction: every read path filters `status = 'APPROVED'`,
     * and the table's check constraint makes that the same fact as having a
     * publish date. The fallback is here so the type is honest rather than
     * asserted — if it ever fires, a row got approved without the constraint,
     * which is a bug worth seeing as a wrong date rather than a crash on a
     * customer-facing page.
     */
    publishedAt: (row.publishedAt ?? new Date(0)).toISOString(),
  };
}
