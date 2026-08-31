import {
  reviewSchema,
  reviewSubmissionSchema,
  reviewSubmitRequestSchema,
  type Review,
  type ReviewSubmission,
  type ReviewSubmitRequest,
} from "@sakura/contracts";
import { z } from "zod";

import { apiFetch } from "./client";

/* --------------------------------------------------------------------------
   Testimonials about the shop and its service — not about a book. Per-title
   reviews live behind the catalog, and nothing here feeds them.

   Every read returns approved rows only; that filter is the API's, in one
   query, and this module deliberately has no way to ask for anything else.
   -------------------------------------------------------------------------- */

const reviewListSchema = z.array(reviewSchema);

/**
 * POST /reviews — submit a testimonial for moderation.
 *
 * Parsed against the request schema before it leaves, so a field the contract
 * does not describe fails here with a path rather than as a 400 the form has
 * to translate back. The response is the acknowledgement, not the row: nothing
 * is public until a moderator approves it, so there is nothing to render.
 */
export function submitReview(request: ReviewSubmitRequest): Promise<ReviewSubmission> {
  const validated = reviewSubmitRequestSchema.parse(request);

  return apiFetch("/reviews", reviewSubmissionSchema, {
    method: "POST",
    body: validated,
    revalidate: false,
  });
}

/** GET /reviews — approved testimonials, newest first. */
export function listReviews(): Promise<Review[]> {
  return apiFetch("/reviews", reviewListSchema, { revalidate: 300 });
}

/** GET /reviews/featured — the hand-picked quotes. */
export function listFeaturedReviews(): Promise<Review[]> {
  return apiFetch("/reviews/featured", reviewListSchema, { revalidate: 300 });
}
