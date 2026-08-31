import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  adminReviewQuerySchema,
  adminReviewUpdateRequestSchema,
  type AdminReview,
  type AdminReviewList,
} from "@sakura/contracts";
import type { Request } from "express";
import { createZodDto } from "nestjs-zod";
import { CurrentAdmin, Roles } from "../auth/admin-auth.decorators";
import type { AccessClaims } from "../auth/tokens";
import type { AdminContext } from "../orders";
import { AdminReviewsService } from "./admin-reviews.service";

class AdminReviewQueryDto extends createZodDto(adminReviewQuerySchema) {}
class AdminReviewUpdateDto extends createZodDto(adminReviewUpdateRequestSchema) {}

/**
 * The moderation queue, over HTTP.
 *
 * Authenticated by AdminJwtGuard on the `admin/` path prefix, like every
 * other controller here. Reading and working the queue carries no `@Roles`:
 * clearing reviews is staff work, and a backlog that only the owner can
 * touch is a backlog.
 *
 * The delete is the exception — see below.
 */
@ApiTags("admin-reviews")
@Controller("admin/reviews")
export class AdminReviewsController {
  constructor(private readonly adminReviewsService: AdminReviewsService) {}

  /**
   * The queue. No cache headers, for the same reason the order queue has
   * none: two staff working a stale list both moderate the same review.
   */
  @Get()
  @ApiOperation({ summary: "Browse submitted testimonials: filter by status, text, date." })
  async list(@Query() query: AdminReviewQueryDto): Promise<AdminReviewList> {
    return this.adminReviewsService.list(query);
  }

  /**
   * Moderate one testimonial — approve, reject, feature, annotate.
   *
   * Addressed by UUID rather than a short code, like the waitlist: a
   * testimonial has no printed identifier and nobody quotes one over the
   * phone.
   * `ParseUUIDPipe` so a malformed id is a 400 here rather than a Postgres
   * cast error surfacing as a 500 three layers down.
   */
  @Patch(":id")
  @ApiOperation({ summary: "Set a testimonial's status, featured/verified flags, or note." })
  async update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: AdminReviewUpdateDto,
    @CurrentAdmin() admin: AccessClaims,
    @Req() request: Request,
  ): Promise<AdminReview> {
    return this.adminReviewsService.update(id, body, contextOf(admin, request));
  }

  /**
   * Delete a testimonial permanently. **ADMIN only.**
   *
   * Restricted where the status changes are not, because this is the one
   * action here that destroys evidence: `REJECTED` and `SPAM` both leave the
   * row, its author and its `ipHash` in place, and staff working the queue
   * have every tool they need without this. It exists for the submission that
   * genuinely must not remain on disk — someone's phone number pasted into
   * the body, or a request to be forgotten — which is an owner's call.
   */
  @Delete(":id")
  @Roles("ADMIN")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Permanently delete a testimonial." })
  async remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AccessClaims,
    @Req() request: Request,
  ): Promise<void> {
    return this.adminReviewsService.remove(id, contextOf(admin, request));
  }
}

function contextOf(actor: AccessClaims, request: Request): AdminContext {
  return {
    actor,
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"],
  };
}
