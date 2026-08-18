import { Controller, Get, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { CategoryGroup } from "@sakura/contracts";
import type { Response } from "express";
import { CategoriesService } from "./categories.service";
import { cacheReference } from "./catalog.cache";

@ApiTags("catalog")
@Controller("categories")
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  /**
   * The filter rail, pre-grouped.
   *
   * Not paginated and not filtered: this is the shop's whole vocabulary, it is
   * small by construction, and a client that has to page through a filter
   * control cannot render one.
   */
  @Get()
  @ApiOperation({ summary: "Categories, grouped for the filter rail" })
  async grouped(@Res({ passthrough: true }) response: Response): Promise<CategoryGroup[]> {
    cacheReference(response);

    return this.categoriesService.grouped();
  }
}
