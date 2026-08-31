import { Module } from "@nestjs/common";
import { ReviewsController } from "./reviews.controller";
import { ReviewsService } from "./reviews.service";

/**
 * Customer testimonials about the platform, storefront side.
 *
 * Self-contained like WaitlistModule, and more so: this module reads and
 * writes exactly one table. It touches no stock, no pricing, no coupons and —
 * unlike almost everything else here — no catalog. A testimonial is about the
 * service, so there is nothing to join to and no reason to depend on
 * CatalogModule.
 *
 * That is also why the feature adds no column to any existing table and
 * changes no existing query. `book_reviews` still owns per-title reviews and
 * still backs the catalog's star average; nothing here feeds it.
 *
 * ReviewsService is exported for AdminReviewsModule's sake in the same shape
 * the waitlist exports its own: the storefront read and the admin write of the
 * same rows should not grow separate ideas of what "approved" means.
 */
@Module({
  controllers: [ReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
