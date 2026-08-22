import type { AdminBookDetail, AdminBookSummary, BookAvailability } from "@sakura/contracts";

/**
 * Database rows → the shapes in @sakura/contracts, admin side.
 *
 * The inverse of catalog/book.mapper.ts's stance: that file exists to *hide*
 * `sku`/`lowStockThreshold`/`unitsSold`/`metaTitle`/`metaDescription` from a
 * customer, and this one exists to expose them — editing those fields is the
 * entire point of the admin surface.
 */

type AuthorLink = { sortOrder: number; author: { name: string } };

function authorNames(links: AuthorLink[]): string[] {
  return [...links].sort((a, b) => a.sortOrder - b.sortOrder).map((link) => link.author.name);
}

export type AdminBookSummaryRow = {
  id: string;
  slug: string;
  title: string;
  coverImageUrl: string;
  priceCents: number;
  compareAtPriceCents: number | null;
  stockQuantity: number;
  lowStockThreshold: number;
  unitsSold: number;
  isActive: boolean;
  isFeatured: boolean;
  availability: BookAvailability;
  authors: AuthorLink[];
};

export function toAdminBookSummary(row: AdminBookSummaryRow): AdminBookSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    authors: authorNames(row.authors),
    coverImageUrl: row.coverImageUrl,
    priceCents: row.priceCents,
    compareAtPriceCents: row.compareAtPriceCents,
    stockQuantity: row.stockQuantity,
    lowStockThreshold: row.lowStockThreshold,
    unitsSold: row.unitsSold,
    isActive: row.isActive,
    isFeatured: row.isFeatured,
    availability: row.availability,
  };
}

export type AdminBookDetailRow = AdminBookSummaryRow & {
  subtitle: string | null;
  isbn10: string | null;
  isbn13: string | null;
  publishedDate: Date | null;
  edition: string | null;
  language: string;
  description: string;
  pageCount: number | null;
  sku: string | null;
  weightGrams: number | null;
  coverImageAlt: string | null;
  galleryImageUrls: string[] | null;
  pdfUrl: string | null;
  pdfFileName: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  createdAt: Date;
  updatedAt: Date;
  publisher: { name: string } | null;
  categories: { category: { slug: string } }[];
};

export function toAdminBookDetail(row: AdminBookDetailRow): AdminBookDetail {
  return {
    ...toAdminBookSummary(row),
    subtitle: row.subtitle,
    isbn10: row.isbn10,
    isbn13: row.isbn13,
    publisherName: row.publisher?.name ?? null,
    publishedDate: row.publishedDate?.toISOString() ?? null,
    edition: row.edition,
    language: row.language,
    description: row.description,
    pageCount: row.pageCount,
    sku: row.sku,
    weightGrams: row.weightGrams,
    coverImageAlt: row.coverImageAlt,
    galleryImageUrls: row.galleryImageUrls ?? [],
    pdfUrl: row.pdfUrl,
    pdfFileName: row.pdfFileName,
    metaTitle: row.metaTitle,
    metaDescription: row.metaDescription,
    authorNames: authorNames(row.authors),
    categorySlugs: row.categories.map((link) => link.category.slug),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
