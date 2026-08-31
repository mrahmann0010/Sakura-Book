import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Review, ReviewSubmission, ReviewSubmitRequest } from "@sakura/contracts";
import { and, asc, desc, eq, type SQL } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import type { Env } from "../config/env.schema";
import { DbService } from "../db/db.service";
import { initialReviews } from "../db/schema";
import { toReview } from "./review.mapper";

/**
 * The storefront's half of the testimonials: a write-only door, and a
 * published-only read.
 *
 * Everything a visitor posts lands `PENDING` and is invisible until a
 * moderator approves it in the admin queue. That is enforced here rather than
 * left to the controller — `submit` never accepts a status, and both reads go
 * through one private method that carries the APPROVED filter in the same
 * expression that selects the rows, so there is no query shape in which it can
 * be forgotten.
 *
 * Note what this service does not touch: `books`, and any query that reads it.
 * A testimonial is about the service.
 */
@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Take a submission. Always creates a PENDING row; never publishes.
   *
   * The response is an acknowledgement rather than the testimonial, so no
   * client can render what it just posted as though it were live — see
   * `reviewSubmissionSchema`.
   */
  async submit(
    request: ReviewSubmitRequest,
    context: { ip?: string; userAgent?: string },
  ): Promise<ReviewSubmission> {
    /*
     * Honeypot. Dropped silently and reported as accepted: telling a bot its
     * submission was rejected is telling it which field to stop filling in,
     * and the whole value of the trap is that it is not obvious. A real
     * visitor cannot reach this branch — the field is hidden and the contract
     * requires it to be empty.
     *
     * The returned id is random and matches no row. That is deliberate: it
     * costs nothing and makes the response indistinguishable from a real one.
     */
    if (request.website) {
      this.logger.warn("Dropped a testimonial submission that filled the honeypot field.");

      return { id: randomUUID(), status: "PENDING" };
    }

    const [row] = await this.dbService.db
      .insert(initialReviews)
      .values({
        /* Trimmed to nothing is nothing. Storing "" would make "did they give
           a name" a check every reader has to write differently. */
        authorName: request.authorName || null,
        authorEmail: request.authorEmail || null,
        rating: request.rating ?? null,
        title: request.title || null,
        body: request.body,
        ipHash: this.hashIp(context.ip),
        userAgent: context.userAgent?.slice(0, 255) || null,
        // status defaults to PENDING; publishedAt stays null. Both are the
        // server's, and neither is reachable from the request shape.
      })
      .returning({ id: initialReviews.id, status: initialReviews.status });

    return { id: row.id, status: row.status };
  }

  /** Every approved testimonial, newest-approved first. */
  async findPublished(): Promise<Review[]> {
    return this.read();
  }

  /**
   * The hand-picked quotes for the home page — `isFeatured` is a moderator
   * saying "this one reads well".
   */
  async findFeatured(limit = 3): Promise<Review[]> {
    return this.read(eq(initialReviews.isFeatured, true), limit);
  }

  /**
   * The one read path, so the APPROVED filter is written once.
   *
   * Both public lists go through here and differ only in an extra condition. A
   * second query shape would be a second place to forget
   * `status = 'APPROVED'`, and forgetting it publishes the moderation queue.
   */
  private async read(condition?: SQL, limit?: number): Promise<Review[]> {
    const query = this.dbService.db
      .select({
        id: initialReviews.id,
        authorName: initialReviews.authorName,
        rating: initialReviews.rating,
        title: initialReviews.title,
        body: initialReviews.body,
        isVerified: initialReviews.isVerified,
        publishedAt: initialReviews.publishedAt,
      })
      .from(initialReviews)
      .where(and(eq(initialReviews.status, "APPROVED"), condition))
      /* Tiebreak on id: two testimonials approved in the same click otherwise
         have no defined order, and the strip would shuffle between renders. */
      .orderBy(desc(initialReviews.publishedAt), asc(initialReviews.id));

    const rows = await (limit === undefined ? query : query.limit(limit));

    return rows.map(toReview);
  }

  /**
   * SHA-256 of the address and a configured salt, or null when no salt is set.
   *
   * Null rather than an unsalted digest — see `REVIEW_IP_SALT` in
   * env.schema.ts for why that fallback would be the address with extra steps.
   */
  private hashIp(ip?: string): string | null {
    const salt = this.config.get("REVIEW_IP_SALT", { infer: true });

    if (!ip || !salt) return null;

    return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
  }
}
