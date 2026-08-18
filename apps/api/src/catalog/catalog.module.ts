import { Module } from "@nestjs/common";
import { AuthorsController } from "./authors.controller";
import { AuthorsService } from "./authors.service";
import { BooksController } from "./books.controller";
import { BooksService } from "./books.service";
import { CategoriesController } from "./categories.controller";
import { CategoriesService } from "./categories.service";

/**
 * The catalog: browse, detail, the category rail, author pages, and the
 * pricing lookup that pricing and checkout depend on.
 *
 * Only BooksService is exported. Categories and authors are read by their own
 * controllers and by nobody else — exporting them "in case" is how a module
 * boundary becomes a suggestion.
 */
@Module({
  controllers: [BooksController, CategoriesController, AuthorsController],
  providers: [BooksService, CategoriesService, AuthorsService],
  exports: [BooksService],
})
export class CatalogModule {}
