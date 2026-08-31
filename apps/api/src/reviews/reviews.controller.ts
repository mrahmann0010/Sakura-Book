import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  reviewSubmitRequestSchema,
  type Review,
  type ReviewSubmission,
} from "@sakura/contracts";
import type { Request, Response } from "express";
import { createZodDto } from "nestjs-zod";
import { StrictThrottle } from "../common/throttling/strict-throttle.decorator";
import { ReviewsService } from "./reviews.service";

class ReviewSubmitDto extends createZodDto(reviewSubmitRequestSchema) {}

/**
 * Customer testimonials about the platform, for the storefront.
 *
 * Every route here is public, and every read returns approved rows only — see
 * ReviewsService.read, the single query the filter lives in.
 */
@ApiTags("reviews")
@Controller("reviews")
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  /**
   * The hand-picked quotes for the home page.
   *
   * Declared before the bare `GET /` below only for readability; Nest matches
   * on the literal path either way. Short public cache like the other
   * storefront reads — this changes when a moderator acts, not per visitor.
   */
  @Get("featured")
  @ApiOperation({ summary: "Approved testimonials a moderator marked as featured." })
  async featured(@Res({ passthrough: true }) response: Response): Promise<Review[]> {
    response.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");

    return this.reviewsService.findFeatured();
  }

  /** Every approved testimonial, newest first. */
  @Get()
  @ApiOperation({ summary: "Approved testimonials about the shop and its service." })
  async list(@Res({ passthrough: true }) response: Response): Promise<Review[]> {
    response.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");

    return this.reviewsService.findPublished();
  }

  /**
   * Submit a testimonial. Always creates a PENDING row — nothing here
   * publishes.
   *
   * Throttled like the waitlist signup and order lookup: an unauthenticated
   * write reachable by anyone, where the tight limit is what stands between
   * this and a script filling the moderation queue faster than a person can
   * empty it.
   *
   * 201 with the acknowledgement, not the row. The client renders "waiting for
   * approval" off the returned status; showing it back as published is how a
   * visitor concludes it failed and submits four more.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @StrictThrottle()
  @ApiOperation({ summary: "Submit a testimonial about the service, for moderation." })
  async submit(@Body() body: ReviewSubmitDto, @Req() request: Request): Promise<ReviewSubmission> {
    return this.reviewsService.submit(body, {
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });
  }
}
