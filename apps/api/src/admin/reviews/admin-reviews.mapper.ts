import type { AdminReview } from "@sakura/contracts";

/**
 * Row → the moderator's view of a testimonial.
 *
 * The mirror image of reviews/review.mapper.ts: this one deliberately carries
 * the email, the note and the spam signals that the public mapper has no
 * field for. Keeping the two shapes in two files, each stated explicitly, is
 * what makes "which of these is safe to render publicly" a question with a
 * one-word answer.
 */

export type AdminReviewRow = {
  id: string;
  authorName: string | null;
  authorEmail: string | null;
  rating: number | null;
  title: string | null;
  body: string;
  status: AdminReview["status"];
  isFeatured: boolean;
  isVerified: boolean;
  moderatorNote: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  ipHash: string | null;
  userAgent: string | null;
  orderNumber: string | null;
};

export function toAdminReview(row: AdminReviewRow): AdminReview {
  return {
    id: row.id,
    authorName: row.authorName,
    authorEmail: row.authorEmail,
    rating: row.rating,
    title: row.title,
    body: row.body,
    status: row.status,
    isFeatured: row.isFeatured,
    isVerified: row.isVerified,
    orderNumber: row.orderNumber,
    moderatorNote: row.moderatorNote,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    submittedAt: row.createdAt.toISOString(),
    ipHash: row.ipHash,
    userAgent: row.userAgent,
  };
}
