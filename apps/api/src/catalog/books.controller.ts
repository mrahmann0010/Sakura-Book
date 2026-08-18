import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { bookQuerySchema, type BookDetail, type BookList } from "@sakura/contracts";
import type { Response } from "express";
import { createZodDto } from "nestjs-zod";
import { BooksService } from "./books.service";
import { cacheCatalog } from "./catalog.cache";

class BookQueryDto extends createZodDto(bookQuerySchema) {}

/**
 * The shelf. Replaces `queryCatalog()` and the hardcoded array in
 * apps/web/src/lib/books.ts.
 */
@ApiTags("catalog")
@Controller("books")
export class BooksController {
  constructor(private readonly booksService: BooksService) {}

  /**
   * Browse, filter, sort, paginate.
   *
   * The query DTO goes through the same global pipe as any body, which is what
   * makes `?page=banana` a VALIDATION_FAILED rather than a silent page 1. The
   * web app's own URL parser stays lenient on purpose — a shareable link
   * should not error — so the two parses differ, and the lenient one must stay
   * on the client side of the wire.
   */
  @Get()
  @ApiOperation({ summary: "Browse the catalog" })
  async list(
    @Query() query: BookQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BookList> {
    cacheCatalog(response);

    return this.booksService.list(query);
  }

  /**
   * One title, by slug.
   *
   * Declared after the collection route so it cannot shadow it, and the param
   * is a slug rather than the UUID primary key: the key never leaves the
   * database, and the URL a customer copies is the one the frontend already
   * routes on.
   */
  @Get(":slug")
  @ApiOperation({ summary: "Full detail for one book" })
  async detail(
    @Param("slug") slug: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BookDetail> {
    cacheCatalog(response);

    return this.booksService.detail(slug);
  }
}
