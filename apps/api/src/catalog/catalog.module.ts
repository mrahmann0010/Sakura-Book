import { Module } from "@nestjs/common";
import { BooksService } from "./books.service";

/**
 * The catalog. No controller yet — browse, detail, categories and authors are
 * Phase 2. What exists now is the read that pricing and checkout need, because
 * a cart cannot be priced without one and the alternative was pricing querying
 * `books` itself.
 */
@Module({
  providers: [BooksService],
  exports: [BooksService],
})
export class CatalogModule {}
