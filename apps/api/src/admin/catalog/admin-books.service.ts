import { Injectable } from "@nestjs/common";
import type {
  AdminBookCreateRequest,
  AdminBookDetail,
  AdminBookList,
  AdminBookQuery,
  AdminBookUpdateRequest,
} from "@sakura/contracts";
import { eq, sql } from "drizzle-orm";
import {
  InvalidInputError,
  ResourceConflictError,
  ResourceNotFoundError,
} from "../../common/errors";
import { slugify } from "../../common/slugify";
import { AuditService } from "../../audit";
import { DbService } from "../../db/db.service";
import type { Transaction } from "../../db/db.types";
import {
  authors,
  bookAuthors,
  bookCategories,
  bookReviews,
  books,
  orderItems,
  publishers,
} from "../../db/schema";
import { categorySelectionProblem } from "./admin-book.categories";
import { adminBookFilters, adminBookOrder } from "./admin-book.query";
import { toAdminBookDetail, toAdminBookSummary } from "./admin-book.mapper";

/** Who did it, for the audit entry — structurally the audit log's AuditActor. */
export type AdminActor = { sub: string; email: string };

const BOOK_DETAIL_WITH = {
  authors: { columns: { sortOrder: true }, with: { author: { columns: { name: true } } } },
  categories: { columns: {}, with: { category: { columns: { slug: true } } } },
  publisher: { columns: { name: true } },
} as const;

type BookInsert = typeof books.$inferInsert;
type BookColumns = Partial<BookInsert>;
/** `slug`/`publisherId` are resolved separately (find-or-create, uniqueness) — see `create`. */
type CreateColumns = Omit<BookInsert, "id" | "slug" | "publisherId" | "createdAt" | "updatedAt">;

/**
 * Every scalar column a create request sets, explicit rather than spread —
 * see book.mapper.ts's comment on why: a field added to the request schema
 * must not reach a column because someone forgot this function exists.
 */
function createColumns(request: AdminBookCreateRequest): CreateColumns {
  return {
    title: request.title,
    subtitle: request.subtitle ?? null,
    isbn10: request.isbn10 ?? null,
    isbn13: request.isbn13 ?? null,
    publishedDate: request.publishedDate ? new Date(request.publishedDate) : null,
    edition: request.edition ?? null,
    language: request.language,
    description: request.description,
    pageCount: request.pageCount ?? null,
    priceCents: request.priceCents,
    compareAtPriceCents: request.compareAtPriceCents ?? null,
    sku: request.sku ?? null,
    stockQuantity: request.stockQuantity,
    lowStockThreshold: request.lowStockThreshold,
    weightGrams: request.weightGrams ?? null,
    coverImageUrl: request.coverImageUrl,
    coverImageAlt: request.coverImageAlt ?? null,
    galleryImageUrls: request.galleryImageUrls,
    pdfUrl: request.pdfUrl ?? null,
    pdfFileName: request.pdfFileName ?? null,
    isActive: request.isActive,
    isFeatured: request.isFeatured,
    availability: request.availability,
    metaTitle: request.metaTitle ?? null,
    metaDescription: request.metaDescription ?? null,
  };
}

/** Only the columns a PATCH actually named — an omitted field must not overwrite anything. */
function updateColumns(request: AdminBookUpdateRequest): BookColumns {
  const columns: BookColumns = {};

  if (request.title !== undefined) columns.title = request.title;
  if (request.subtitle !== undefined) columns.subtitle = request.subtitle ?? null;
  if (request.isbn10 !== undefined) columns.isbn10 = request.isbn10 ?? null;
  if (request.isbn13 !== undefined) columns.isbn13 = request.isbn13 ?? null;
  if (request.publishedDate !== undefined) columns.publishedDate = new Date(request.publishedDate);
  if (request.edition !== undefined) columns.edition = request.edition ?? null;
  if (request.language !== undefined) columns.language = request.language;
  if (request.description !== undefined) columns.description = request.description;
  if (request.pageCount !== undefined) columns.pageCount = request.pageCount ?? null;
  if (request.priceCents !== undefined) columns.priceCents = request.priceCents;
  if (request.compareAtPriceCents !== undefined) {
    columns.compareAtPriceCents = request.compareAtPriceCents ?? null;
  }
  if (request.sku !== undefined) columns.sku = request.sku ?? null;
  if (request.stockQuantity !== undefined) columns.stockQuantity = request.stockQuantity;
  if (request.lowStockThreshold !== undefined) {
    columns.lowStockThreshold = request.lowStockThreshold;
  }
  if (request.weightGrams !== undefined) columns.weightGrams = request.weightGrams ?? null;
  if (request.coverImageUrl !== undefined) columns.coverImageUrl = request.coverImageUrl;
  if (request.coverImageAlt !== undefined) columns.coverImageAlt = request.coverImageAlt ?? null;
  if (request.galleryImageUrls !== undefined) {
    columns.galleryImageUrls = request.galleryImageUrls;
  }
  if (request.pdfUrl !== undefined) columns.pdfUrl = request.pdfUrl ?? null;
  if (request.pdfFileName !== undefined) columns.pdfFileName = request.pdfFileName ?? null;
  if (request.isActive !== undefined) columns.isActive = request.isActive;
  if (request.isFeatured !== undefined) columns.isFeatured = request.isFeatured;
  if (request.availability !== undefined) columns.availability = request.availability;
  if (request.metaTitle !== undefined) columns.metaTitle = request.metaTitle ?? null;
  if (request.metaDescription !== undefined) {
    columns.metaDescription = request.metaDescription ?? null;
  }

  /* The request-level refine only catches a PATCH that sets both fields at
     once. Flipping a book to `coming_soon` without also repeating
     `stockQuantity: 0` is still a request that must not leave the row
     carrying stock a `coming_soon` book can never sell — so force it here,
     the one place that sees the existing row too. */
  if (columns.availability === "coming_soon" && columns.stockQuantity === undefined) {
    columns.stockQuantity = 0;
  }

  return columns;
}

/**
 * Book catalog management, admin side.
 *
 * There was no admin-facing catalog surface before this — every write here is
 * new ground, unlike admin/orders, which is a thin authenticated wrapper
 * around OrdersService. `create`/`update` own the transaction directly
 * because there is no domain service for "author/publisher find-or-create
 * plus a junction-table replace" to delegate to.
 *
 * `remove` hard-deletes a book, but only when it has never sold: `order_items`
 * references `books`, so a title with order history cannot be removed without
 * either breaking historical orders or cascading their line items away.
 * Deactivation (`isActive: false`, via `update`) stays the only removal path
 * for a title that has sold — the same choice `admin_users` makes for staff
 * who leave.
 */
@Injectable()
export class AdminBooksService {
  constructor(
    private readonly dbService: DbService,
    private readonly auditService: AuditService,
  ) {}

  async list(query: AdminBookQuery): Promise<AdminBookList> {
    const where = adminBookFilters(query);
    const offset = (query.page - 1) * query.pageSize;

    const [matched, [{ total }]] = await Promise.all([
      this.dbService.db
        .select({ id: books.id })
        .from(books)
        .where(where)
        .orderBy(...adminBookOrder(query.sort))
        .limit(query.pageSize)
        .offset(offset),
      this.dbService.db
        .select({ total: sql<number>`count(*)::int` })
        .from(books)
        .where(where),
    ]);

    const ids = matched.map((row) => row.id);
    const rows =
      ids.length === 0
        ? []
        : await this.dbService.db.query.books.findMany({
            where: (book, { inArray }) => inArray(book.id, ids),
            with: { authors: BOOK_DETAIL_WITH.authors },
          });

    const byId = new Map(rows.map((row) => [row.id, row]));

    return {
      // Re-imposes the ordered-id list's order — `where id in (...)` has none.
      items: ids.flatMap((id) => {
        const row = byId.get(id);
        return row ? [toAdminBookSummary(row)] : [];
      }),
      total,
      page: query.page,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async detail(id: string): Promise<AdminBookDetail> {
    const row = await this.requireBook(id);
    return toAdminBookDetail(row);
  }

  async create(request: AdminBookCreateRequest, actor: AdminActor): Promise<AdminBookDetail> {
    const slug = request.slug ?? (await this.uniqueSlug(request.title));

    const bookId = await this.dbService.db.transaction(async (tx) => {
      const publisherId = request.publisherName
        ? await this.findOrCreatePublisher(tx, request.publisherName)
        : null;

      const [inserted] = await tx
        .insert(books)
        .values({ ...createColumns(request), slug, publisherId })
        .returning({ id: books.id });

      await this.replaceRelations(tx, inserted.id, request.authorNames, request.categorySlugs, {
        requireCoverage: true,
      });

      await this.auditService.record(
        {
          actor,
          action: "CREATE",
          entityType: "books",
          entityId: inserted.id,
          after: { title: request.title, slug, priceCents: request.priceCents },
        },
        tx,
      );

      return inserted.id;
    });

    return this.detail(bookId);
  }

  async update(
    id: string,
    request: AdminBookUpdateRequest,
    actor: AdminActor,
  ): Promise<AdminBookDetail> {
    const existing = await this.requireBook(id);
    const columns = updateColumns(request);

    await this.dbService.db.transaction(async (tx) => {
      const publisherId =
        request.publisherName !== undefined
          ? request.publisherName
            ? await this.findOrCreatePublisher(tx, request.publisherName)
            : null
          : undefined;

      if (Object.keys(columns).length > 0 || publisherId !== undefined) {
        await tx
          .update(books)
          .set({ ...columns, ...(publisherId !== undefined ? { publisherId } : {}) })
          .where(eq(books.id, id));
      }

      if (request.authorNames !== undefined || request.categorySlugs !== undefined) {
        await this.replaceRelations(
          tx,
          id,
          request.authorNames ?? existing.authors.map((link) => link.author.name),
          request.categorySlugs ?? existing.categories.map((link) => link.category.slug),
          /* Only what this request actually chose is held to the skill/level
             rule. A book saved before the rule existed can be short of one —
             the reference title carrying no `level` is a real row — and making
             every PATCH re-assert the categories would leave that book
             uneditable: renaming it would fail on a field the request never
             mentioned. Send `categorySlugs` and it is checked; omit it and the
             existing links are carried over untouched. */
          { requireCoverage: request.categorySlugs !== undefined },
        );
      }

      const before: BookColumns = {};
      for (const key of Object.keys(columns) as (keyof BookColumns)[]) {
        (before as Record<string, unknown>)[key] = (existing as Record<string, unknown>)[key];
      }

      await this.auditService.record(
        { actor, action: "UPDATE", entityType: "books", entityId: id, before, after: columns },
        tx,
      );
    });

    return this.detail(id);
  }

  /**
   * Hard-delete a book, refusing when it has order history.
   *
   * The junction rows (`book_authors`, `book_categories`) and any reviews are
   * this book's alone and go with it. `order_items.bookId` is left standing —
   * a book with any order line is rejected before the transaction opens, so
   * that column is never actually reached by this method.
   */
  async remove(id: string, actor: AdminActor): Promise<void> {
    const existing = await this.requireBook(id);

    const [{ count: orderCount }] = await this.dbService.db
      .select({ count: sql<number>`count(*)::int` })
      .from(orderItems)
      .where(eq(orderItems.bookId, id));

    if (orderCount > 0) {
      throw new ResourceConflictError(
        "This book has order history and cannot be deleted — deactivate it instead.",
        { bookId: id, orderCount },
      );
    }

    await this.dbService.db.transaction(async (tx) => {
      await tx.delete(bookReviews).where(eq(bookReviews.bookId, id));
      await tx.delete(bookAuthors).where(eq(bookAuthors.bookId, id));
      await tx.delete(bookCategories).where(eq(bookCategories.bookId, id));
      await tx.delete(books).where(eq(books.id, id));

      await this.auditService.record(
        {
          actor,
          action: "DELETE",
          entityType: "books",
          entityId: id,
          before: { title: existing.title, slug: existing.slug },
        },
        tx,
      );
    });
  }

  private async requireBook(id: string) {
    const row = await this.dbService.db.query.books.findFirst({
      where: eq(books.id, id),
      with: BOOK_DETAIL_WITH,
    });

    if (!row) throw new ResourceNotFoundError("Book", id);
    return row;
  }

  /**
   * Delete-and-reinsert the junction rows, matching the "full replace"
   * convention `admin-pre-order-books.service.ts`'s PUT uses — simpler than a
   * diff, and correct because a book's author/category list is short.
   */
  private async replaceRelations(
    tx: Transaction,
    bookId: string,
    authorNames: string[],
    categorySlugs: string[],
    { requireCoverage }: { requireCoverage: boolean },
  ): Promise<void> {
    const categoryIds = await this.resolveCategories(tx, categorySlugs, requireCoverage);

    await tx.delete(bookAuthors).where(eq(bookAuthors.bookId, bookId));
    await tx.delete(bookCategories).where(eq(bookCategories.bookId, bookId));

    for (const [index, name] of authorNames.entries()) {
      const authorId = await this.findOrCreateAuthor(tx, name);
      await tx.insert(bookAuthors).values({ bookId, authorId, sortOrder: index });
    }

    if (categoryIds.length > 0) {
      await tx.insert(bookCategories).values(categoryIds.map((id) => ({ bookId, categoryId: id })));
    }
  }

  /**
   * Slugs to category ids, refusing a set that does not describe a book this
   * shop can sell. The rule itself is `categorySelectionProblem` — this is the
   * database half: fetch the rows, then turn a problem into the error the API
   * reports.
   */
  private async resolveCategories(
    tx: Transaction,
    slugs: string[],
    requireCoverage: boolean,
  ): Promise<string[]> {
    /* De-duplicated first: `book_categories` has a composite primary key, so
       the same slug twice in one request would fail the insert on a conflict
       rather than being the no-op the operator meant. */
    const wanted = [...new Set(slugs)];

    const rows =
      wanted.length > 0
        ? await tx.query.categories.findMany({
            where: (category, { inArray }) => inArray(category.slug, wanted),
            columns: { id: true, slug: true, group: true },
          })
        : [];

    const problem = categorySelectionProblem(wanted, rows, requireCoverage);
    if (problem) throw new InvalidInputError(problem.message, problem.details);

    return rows.map((row) => row.id);
  }

  /**
   * Find an author by slug, or create one. Slug collisions between two
   * different names are not guarded against here — same risk the sample
   * catalog seed already accepts, and for the same reason: a shop adding a
   * dozen authors a year is not the adversarial case this needs to defend.
   */
  private async findOrCreateAuthor(tx: Transaction, name: string): Promise<string> {
    const slug = slugify(name);

    const [inserted] = await tx
      .insert(authors)
      .values({ slug, name: name.trim() })
      .onConflictDoNothing({ target: authors.slug })
      .returning({ id: authors.id });

    if (inserted) return inserted.id;

    const existing = await tx.query.authors.findFirst({ where: eq(authors.slug, slug) });
    return existing!.id;
  }

  private async findOrCreatePublisher(tx: Transaction, name: string): Promise<string> {
    const slug = slugify(name);

    const [inserted] = await tx
      .insert(publishers)
      .values({ slug, name: name.trim() })
      .onConflictDoNothing({ target: publishers.slug })
      .returning({ id: publishers.id });

    if (inserted) return inserted.id;

    const existing = await tx.query.publishers.findFirst({ where: eq(publishers.slug, slug) });
    return existing!.id;
  }

  /** Appends a numeric suffix until the slug is free — titles repeat, URLs may not. */
  private async uniqueSlug(title: string): Promise<string> {
    const base = slugify(title);
    let candidate = base;
    let suffix = 2;

    while (
      await this.dbService.db.query.books.findFirst({
        where: eq(books.slug, candidate),
        columns: { id: true },
      })
    ) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }

    return candidate;
  }
}
