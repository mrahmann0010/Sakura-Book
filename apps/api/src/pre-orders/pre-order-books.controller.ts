import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { PreOrderBook } from "@sakura/contracts";
import { PreOrderBooksService } from "./pre-order-books.service";

/** Public read of the pre-order shelf: today, exactly one book or none. */
@ApiTags("pre-order-books")
@Controller("pre-order-books")
export class PreOrderBooksController {
  constructor(private readonly preOrderBooksService: PreOrderBooksService) {}

  /**
   * The active pre-order book, or `null` — not 404 — when there is not one.
   *
   * Null rather than a 404 keeps this the same shape as every other "maybe
   * nothing right now" read (compare GET /shipping/terms): the catalog page
   * calls this on every render and treats the response as data, not as a
   * failure to branch on.
   */
  @Get("active")
  @ApiOperation({ summary: "The pre-order book currently on sale, or null." })
  async active(): Promise<PreOrderBook | null> {
    return this.preOrderBooksService.findActive();
  }
}
