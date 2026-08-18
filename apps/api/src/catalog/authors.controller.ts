import { Controller, Get, Param, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { AuthorDetail } from "@sakura/contracts";
import type { Response } from "express";
import { AuthorsService } from "./authors.service";
import { cacheReference } from "./catalog.cache";

@ApiTags("catalog")
@Controller("authors")
export class AuthorsController {
  constructor(private readonly authorsService: AuthorsService) {}

  @Get(":slug")
  @ApiOperation({ summary: "An author and the books credited to them" })
  async detail(
    @Param("slug") slug: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthorDetail> {
    cacheReference(response);

    return this.authorsService.detail(slug);
  }
}
