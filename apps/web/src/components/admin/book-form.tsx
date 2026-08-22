"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { AdminBookCreateRequest, AdminBookDetail, CategoryGroup } from "@sakura/contracts";

import { Button, Checkbox, Input, Textarea } from "@/components/ui";
import { FileUpload } from "@/components/admin/file-upload";
import { AdminApiError, uploadAdminCover, uploadAdminPdf } from "@/lib/api/admin";
import { getCategories } from "@/lib/api/catalog";

export type BookFormValues = Omit<AdminBookCreateRequest, "slug">;

type FormState = {
  title: string;
  subtitle: string;
  isbn10: string;
  isbn13: string;
  publisherName: string;
  authorNames: string;
  categorySlugs: string[];
  language: string;
  edition: string;
  pageCount: string;
  description: string;
  priceCents: string;
  compareAtPriceCents: string;
  sku: string;
  stockQuantity: string;
  lowStockThreshold: string;
  weightGrams: string;
  coverImageUrl: string;
  coverImageAlt: string;
  galleryImageUrls: string[];
  pdfUrl: string;
  pdfFileName: string;
  isActive: boolean;
  isFeatured: boolean;
  metaTitle: string;
  metaDescription: string;
};

const emptyForm: FormState = {
  title: "",
  subtitle: "",
  isbn10: "",
  isbn13: "",
  publisherName: "",
  authorNames: "",
  categorySlugs: [],
  language: "en",
  edition: "",
  pageCount: "",
  description: "",
  priceCents: "",
  compareAtPriceCents: "",
  sku: "",
  stockQuantity: "0",
  lowStockThreshold: "5",
  weightGrams: "",
  coverImageUrl: "",
  coverImageAlt: "",
  galleryImageUrls: [],
  pdfUrl: "",
  pdfFileName: "",
  isActive: true,
  isFeatured: false,
  metaTitle: "",
  metaDescription: "",
};

function fromDetail(book: AdminBookDetail): FormState {
  return {
    title: book.title,
    subtitle: book.subtitle ?? "",
    isbn10: book.isbn10 ?? "",
    isbn13: book.isbn13 ?? "",
    publisherName: book.publisherName ?? "",
    authorNames: book.authorNames.join(", "),
    categorySlugs: book.categorySlugs,
    language: book.language,
    edition: book.edition ?? "",
    pageCount: book.pageCount ? String(book.pageCount) : "",
    description: book.description,
    priceCents: String(book.priceCents),
    compareAtPriceCents: book.compareAtPriceCents ? String(book.compareAtPriceCents) : "",
    sku: book.sku ?? "",
    stockQuantity: String(book.stockQuantity),
    lowStockThreshold: String(book.lowStockThreshold),
    weightGrams: book.weightGrams ? String(book.weightGrams) : "",
    coverImageUrl: book.coverImageUrl,
    coverImageAlt: book.coverImageAlt ?? "",
    galleryImageUrls: book.galleryImageUrls,
    pdfUrl: book.pdfUrl ?? "",
    pdfFileName: book.pdfFileName ?? "",
    isActive: book.isActive,
    isFeatured: book.isFeatured,
    metaTitle: book.metaTitle ?? "",
    metaDescription: book.metaDescription ?? "",
  };
}

/** Empty optional string → `undefined`, so a cleared field is omitted rather than sent as `""`. */
function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function toRequest(form: FormState): BookFormValues {
  return {
    title: form.title.trim(),
    subtitle: optional(form.subtitle),
    isbn10: optional(form.isbn10),
    isbn13: optional(form.isbn13),
    publisherName: optional(form.publisherName),
    authorNames: form.authorNames
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
    categorySlugs: form.categorySlugs,
    language: form.language.trim() || "en",
    edition: optional(form.edition),
    pageCount: form.pageCount ? Number(form.pageCount) : undefined,
    description: form.description.trim(),
    priceCents: Number(form.priceCents),
    compareAtPriceCents: form.compareAtPriceCents ? Number(form.compareAtPriceCents) : undefined,
    sku: optional(form.sku),
    stockQuantity: Number(form.stockQuantity),
    lowStockThreshold: Number(form.lowStockThreshold),
    weightGrams: form.weightGrams ? Number(form.weightGrams) : undefined,
    coverImageUrl: form.coverImageUrl.trim(),
    coverImageAlt: optional(form.coverImageAlt),
    galleryImageUrls: form.galleryImageUrls,
    pdfUrl: optional(form.pdfUrl),
    pdfFileName: optional(form.pdfFileName),
    isActive: form.isActive,
    isFeatured: form.isFeatured,
    metaTitle: optional(form.metaTitle),
    metaDescription: optional(form.metaDescription),
  };
}

/**
 * Create/edit form for one book. Shared by `/admin/books/new` and
 * `/admin/books/[id]/edit` — the two differ only in the initial values and
 * what the submit handler does with the result, both supplied by the caller.
 *
 * Authors are a comma-separated tag field rather than a picker, and the
 * publisher is free text: both are find-or-created by name on the server
 * (admin-books.service.ts) — a shop adding a new author or publisher should
 * not need a separate screen for it first. Categories are checkboxes over the
 * *existing* taxonomy only, fetched from the storefront's own
 * `getCategories()` — that vocabulary is seeded reference data, not something
 * this form creates.
 */
export function BookForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: AdminBookDetail;
  submitLabel: string;
  onSubmit: (values: BookFormValues) => Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(initial ? fromDetail(initial) : emptyForm);
  const [categoryGroups, setCategoryGroups] = useState<CategoryGroup[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCategories()
      .then(setCategoryGroups)
      .catch(() => {
        // The form still works with no categories selected — this only
        // degrades the checkbox list, it does not block saving a book.
      });
  }, []);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleCategory(slug: string) {
    setForm((current) => ({
      ...current,
      categorySlugs: current.categorySlugs.includes(slug)
        ? current.categorySlugs.filter((s) => s !== slug)
        : [...current.categorySlugs, slug],
    }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSubmit(toRequest(form));
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Could not save this book.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-8">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Title"
          required
          value={form.title}
          onChange={(event) => set("title", event.target.value)}
        />
        <Input
          label="Subtitle"
          value={form.subtitle}
          onChange={(event) => set("subtitle", event.target.value)}
        />
        <Input
          label="Authors (comma-separated)"
          required
          hint="New names are added to the author list automatically."
          value={form.authorNames}
          onChange={(event) => set("authorNames", event.target.value)}
        />
        <Input
          label="Publisher"
          hint="Leave blank if unknown. New names are added automatically."
          value={form.publisherName}
          onChange={(event) => set("publisherName", event.target.value)}
        />
        <Input
          label="ISBN-10"
          value={form.isbn10}
          onChange={(event) => set("isbn10", event.target.value)}
        />
        <Input
          label="ISBN-13"
          value={form.isbn13}
          onChange={(event) => set("isbn13", event.target.value)}
        />
        <Input
          label="Edition"
          value={form.edition}
          onChange={(event) => set("edition", event.target.value)}
        />
        <Input
          label="Language"
          value={form.language}
          onChange={(event) => set("language", event.target.value)}
        />
        <Input
          label="Page count"
          type="number"
          min={1}
          value={form.pageCount}
          onChange={(event) => set("pageCount", event.target.value)}
        />
        <Input
          label="Weight (grams)"
          type="number"
          min={1}
          value={form.weightGrams}
          onChange={(event) => set("weightGrams", event.target.value)}
        />
      </section>

      <Textarea
        label="Description"
        required
        rows={5}
        value={form.description}
        onChange={(event) => set("description", event.target.value)}
      />

      {categoryGroups.length > 0 ? (
        <div>
          <p className="text-caption tracking-eyebrow text-muted mb-2 uppercase">Categories</p>
          <div className="flex flex-col gap-4">
            {categoryGroups.map((group) => (
              <div key={group.group ?? "ungrouped"}>
                {group.group ? (
                  <p className="text-13.5 text-secondary mb-1 capitalize">{group.group}</p>
                ) : null}
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {group.categories.map((category) => (
                    <Checkbox
                      key={category.slug}
                      checked={form.categorySlugs.includes(category.slug)}
                      onChange={() => toggleCategory(category.slug)}
                    >
                      {category.name}
                    </Checkbox>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          label="Price (cents)"
          type="number"
          required
          min={0}
          value={form.priceCents}
          onChange={(event) => set("priceCents", event.target.value)}
        />
        <Input
          label="Compare-at price (cents)"
          type="number"
          min={0}
          hint="Optional — must be higher than the price."
          value={form.compareAtPriceCents}
          onChange={(event) => set("compareAtPriceCents", event.target.value)}
        />
        <Input label="SKU" value={form.sku} onChange={(event) => set("sku", event.target.value)} />
        <Input
          label="Stock quantity"
          type="number"
          required
          min={0}
          value={form.stockQuantity}
          onChange={(event) => set("stockQuantity", event.target.value)}
        />
        <Input
          label="Low stock threshold"
          type="number"
          required
          min={0}
          value={form.lowStockThreshold}
          onChange={(event) => set("lowStockThreshold", event.target.value)}
        />
      </section>

      <section className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-3">
          <FileUpload
            label="Cover image"
            accept="image/jpeg,image/png,image/webp"
            uploadFn={uploadAdminCover}
            onUploaded={(result) => set("coverImageUrl", result.url)}
          />
          <Input
            label="Cover image URL"
            required
            hint="Set automatically by the upload above — or paste one directly."
            value={form.coverImageUrl}
            onChange={(event) => set("coverImageUrl", event.target.value)}
          />
          <Input
            label="Cover image alt text"
            value={form.coverImageAlt}
            onChange={(event) => set("coverImageAlt", event.target.value)}
          />
          {form.coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- an admin-supplied/external URL, not a Next-optimized asset
            <img
              src={form.coverImageUrl}
              alt=""
              className="rounded-control border-rule h-40 w-28 border object-cover"
            />
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          <FileUpload
            label="Sample PDF"
            accept="application/pdf"
            uploadFn={uploadAdminPdf}
            onUploaded={(result) => {
              set("pdfUrl", result.url);
              if (result.fileName) set("pdfFileName", result.fileName);
            }}
          />
          <Input
            label="PDF URL"
            hint="Optional — a sample chapter, not the full book."
            value={form.pdfUrl}
            onChange={(event) => set("pdfUrl", event.target.value)}
          />
          {form.pdfUrl ? (
            <>
              <iframe
                src={form.pdfUrl}
                title={form.pdfFileName || "PDF preview"}
                className="rounded-control border-rule h-64 w-full border"
              />
              <a
                href={form.pdfUrl}
                target="_blank"
                rel="noreferrer"
                className="text-13.5 text-clay hover:text-clay-deep"
              >
                Open {form.pdfFileName || "the PDF"} in a new tab
              </a>
            </>
          ) : null}
        </div>
      </section>

      <section className="flex flex-wrap gap-6">
        <Checkbox
          checked={form.isActive}
          onChange={(event) => set("isActive", event.target.checked)}
        >
          Active (shown on the storefront)
        </Checkbox>
        <Checkbox
          checked={form.isFeatured}
          onChange={(event) => set("isFeatured", event.target.checked)}
        >
          Featured
        </Checkbox>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Meta title"
          hint="SEO — leave blank to fall back to the title."
          value={form.metaTitle}
          onChange={(event) => set("metaTitle", event.target.value)}
        />
        <Input
          label="Meta description"
          hint="SEO — leave blank to fall back to the description."
          value={form.metaDescription}
          onChange={(event) => set("metaDescription", event.target.value)}
        />
      </section>

      {error ? <p className="text-13.5 text-clay-deep">{error}</p> : null}

      <div>
        <Button type="submit" loading={saving} loadingLabel="Saving">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
