import { Injectable } from "@nestjs/common";
import type { AuthorDetail } from "@sakura/contracts";
import { and, asc, desc, eq } from "drizzle-orm";
import { DbService } from "../db/db.service";
import type { Executor } from "../db/db.types";
import { bookAuthors, books } from "../db/schema";
import { AuthorNotFoundError } from "./book.errors";
import { BooksService } from "./books.service";

/**
 * An author and the books credited to them.
 *
 * Depends on BooksService rather than selecting book columns itself, so the
 * author page's cards are literally the same shape — including the rating
 * rollup — as the browse grid's. Two queries that both claim to produce a book
 * card is how one of them ends up missing a field.
 */
@Injectable()
export class AuthorsService {
  constructor(
    private readonly dbService: DbService,
    private readonly booksService: BooksService,
  ) {}

  async detail(slug: string, executor: Executor = this.dbService.db): Promise<AuthorDetail> {
    const author = await executor.query.authors.findFirst({
      where: (row, { eq: equals }) => equals(row.slug, slug),
      columns: { id: true, slug: true, name: true, bio: true, photoUrl: true },
    });

    if (!author) throw new AuthorNotFoundError(slug);

    /**
     * Newest first, and active only.
     *
     * Deliberately not paginated. An author on a hand-picked shelf has a
     * handful of titles, and a page control under three books is furniture. If
     * that stops being true the fix is this endpoint growing a page param, not
     * the client slicing a list it was sent in full.
     */
    const credited = await executor
      .select({ id: books.id })
      .from(bookAuthors)
      .innerJoin(books, eq(books.id, bookAuthors.bookId))
      .where(and(eq(bookAuthors.authorId, author.id), eq(books.isActive, true)))
      .orderBy(desc(books.createdAt), asc(books.id));

    return {
      slug: author.slug,
      name: author.name,
      bio: author.bio,
      photoUrl: author.photoUrl,
      books: await this.booksService.summariesByIds(
        credited.map((row) => row.id),
        executor,
      ),
    };
  }
}
