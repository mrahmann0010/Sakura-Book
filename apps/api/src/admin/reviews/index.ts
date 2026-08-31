/**
 * Same shape as `admin/waitlist`'s barrel, and for the same reason: nothing
 * outside `admin/` imports this today, but the module-boundary rule needs a
 * public surface to point at when something does.
 */
export { AdminReviewsController } from "./admin-reviews.controller";
export { AdminReviewsService } from "./admin-reviews.service";
