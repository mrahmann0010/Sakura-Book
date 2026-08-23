"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  AdminBookCreateInput,
  AdminBookDetail,
  BookAvailability,
  CategoryGroup,
} from "@sakura/contracts";

import { Button, Checkbox, Input, Select, Textarea } from "@/components/ui";
import { FileUpload } from "@/components/admin/file-upload";
import { AdminApiError, uploadAdminCover, uploadAdminPdf } from "@/lib/api/admin";
import { getCategories } from "@/lib/api/catalog";

/**
 * The payload this form produces — the schema's *input*, not its output, so
 * the fields the create schema defaults (stock, threshold, language, the
 * flags) may be left out and filled in server-side. See `AdminBookCreateInput`.
 */
export type BookFormValues = Omit<AdminBookCreateInput, "slug">;

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
  publishedDate: string;
  pageCount: string;
  description: string;
  priceCents: string;
  compareAtPriceCents: string;
  sku: string;
  stockQuantity: string;
  lowStockThreshold: string;
  availability: BookAvailability;
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
  publishedDate: "",
  pageCount: "",
  description: "",
  priceCents: "",
  compareAtPriceCents: "",
  sku: "",
  stockQuantity: "0",
  lowStockThreshold: "5",
  availability: "in_stock",
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
    // `publishedDate` is a full timestamp on the wire; the date input only
    // wants the date part.
    publishedDate: book.publishedDate ? book.publishedDate.slice(0, 10) : "",
    pageCount: book.pageCount ? String(book.pageCount) : "",
    description: book.description,
    priceCents: String(book.priceCents),
    compareAtPriceCents: book.compareAtPriceCents ? String(book.compareAtPriceCents) : "",
    sku: book.sku ?? "",
    stockQuantity: String(book.stockQuantity),
    lowStockThreshold: String(book.lowStockThreshold),
    availability: book.availability,
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

/**
 * Request-field name → the label this form puts above it.
 *
 * A validation failure arrives keyed by the field in the *request* (`priceCents`,
 * `authorNames`), which is not what the operator is looking at ("Price (cents)",
 * "Authors"). Without this the summary would name fields that appear nowhere on
 * screen. Anything missing from the map falls back to the raw path, which is
 * still better than the generic message this replaces.
 */
const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  subtitle: "Subtitle",
  isbn10: "ISBN-10",
  isbn13: "ISBN-13",
  publisherName: "Publisher",
  authorNames: "Authors",
  categorySlugs: "Categories",
  language: "Language",
  edition: "Edition",
  publishedDate: "Published date",
  pageCount: "Page count",
  description: "Description",
  priceCents: "Price (cents)",
  compareAtPriceCents: "Compare-at price (cents)",
  sku: "SKU",
  stockQuantity: "Stock quantity",
  lowStockThreshold: "Low stock threshold",
  availability: "Availability",
  weightGrams: "Weight (grams)",
  coverImageUrl: "Cover image URL",
  coverImageAlt: "Cover image alt text",
  galleryImageUrls: "Gallery images",
  pdfUrl: "PDF URL",
  pdfFileName: "PDF file name",
  metaTitle: "Meta title",
  metaDescription: "Meta description",
  slug: "Slug",
};

/**
 * The category groups a book cannot be saved without — the client half of
 * `REQUIRED_CATEGORY_GROUPS` in `admin-books.service.ts`. Checked here so the
 * operator is told which box to tick before a round trip, and there so it
 * holds for any caller; neither is redundant.
 */
const REQUIRED_CATEGORY_GROUPS: { group: string; label: string }[] = [
  { group: "skill", label: "skill" },
  { group: "level", label: "JLPT level" },
];

/** Empty optional string → `undefined`, so a cleared field is omitted rather than sent as `""`. */
function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Same, for the number inputs whose fields are optional.
 *
 * `Number("")` is 0, not NaN, so a cleared stock field would silently post a
 * real zero and take the book out of stock. Anything non-numeric *is* NaN, and
 * `JSON.stringify(NaN)` is `null`, which the schema rejects with "expected
 * number, received null" — true but unhelpful in front of an empty box. Both
 * become `undefined`, and the server applies its own default.
 */
function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Turn one field error into something an operator can act on.
 *
 * `fieldErrorSchema` calls its `message` "developer-facing English. Clients
 * translate from `code` + `path`." — so this is that translation. Where the
 * schema author wrote a real message ("Publisher is required.", "Compare-at
 * price must be higher than the price.") the code is `custom` or `too_small`
 * with copy already aimed at a person, and it passes through untouched. What
 * needs replacing is Zod's structural default: "Invalid input: expected int,
 * received number" is true and useless in front of a box labelled "Price
 * (cents)" that someone typed 12.50 into.
 */
function humanise(path: string, code: string, message: string): string {
  if (code === "invalid_type") {
    if (INTEGER_FIELDS.has(path)) return "Whole numbers only — no decimal point.";
    return "This does not look like the right kind of value.";
  }
  if (code === "invalid_format" && path === "publishedDate") {
    return "Pick a date, or leave it blank.";
  }
  return message;
}

/**
 * The fields the schema types as `z.number().int()`, so a decimal reads as a
 * type error rather than a range one. Listed here because the reply says only
 * "expected int" and cannot say which of the form's boxes that was.
 */
const INTEGER_FIELDS = new Set([
  "priceCents",
  "compareAtPriceCents",
  "pageCount",
  "stockQuantity",
  "lowStockThreshold",
  "weightGrams",
]);

/**
 * One line covering everything that needs attention.
 *
 * Derived at render time from the field errors rather than stored beside them,
 * so it cannot say "2 fields need fixing" after one has been corrected — which
 * it did while the two were separate pieces of state.
 *
 * A single problem is stated outright: with one field there is nothing to
 * disambiguate, and "Categories needs fixing — see the message under it" is
 * strictly worse than the message. Several become a list of names, because
 * three full sentences run together in one banner read as a wall.
 */
function summarise(byPath: Record<string, string>): string {
  const entries = Object.entries(byPath);
  if (entries.length === 0) return "";

  const label = (path: string) => FIELD_LABELS[path] ?? path;

  if (entries.length === 1) {
    const [path, message] = entries[0];
    return `${label(path)}: ${message}`;
  }
  return `${entries.length} fields need fixing: ${entries.map(([path]) => label(path)).join(", ")}.`;
}

function toRequest(form: FormState): BookFormValues {
  return {
    title: form.title.trim(),
    subtitle: optional(form.subtitle),
    isbn10: optional(form.isbn10),
    isbn13: optional(form.isbn13),
    publisherName: form.publisherName.trim(),
    authorNames: form.authorNames
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
    categorySlugs: form.categorySlugs,
    language: form.language.trim() || "en",
    edition: optional(form.edition),
    publishedDate: optional(form.publishedDate),
    pageCount: optionalNumber(form.pageCount),
    description: form.description.trim(),
    priceCents: Number(form.priceCents),
    compareAtPriceCents: optionalNumber(form.compareAtPriceCents),
    sku: optional(form.sku),
    // A coming-soon book is never orderable — the API refuses (and this form
    // never lets you type) a non-zero stock count against it, see `set()`.
    // Both are optional: left blank, the server applies 0 and 5.
    stockQuantity: optionalNumber(form.stockQuantity),
    lowStockThreshold: optionalNumber(form.lowStockThreshold),
    availability: form.availability,
    weightGrams: optionalNumber(form.weightGrams),
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
  /** Request-field path → what is wrong with it. Keyed the way the server keys it. */
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    getCategories()
      .then(setCategoryGroups)
      .catch(() => {
        // The form still works with no categories selected — this only
        // degrades the checkbox list, it does not block saving a book.
      });
  }, []);

  /**
   * Put the cursor on the first rejected field.
   *
   * The form is roughly three screens tall and Save is at the bottom, so a
   * complaint about the Title is out of sight at the moment it appears. The
   * banner names the field; this goes there. Reads the DOM rather than
   * threading a ref through every input, because `aria-invalid` is already on
   * exactly the controls in question and the order it finds them in is the
   * order they appear on screen.
   */
  useEffect(() => {
    if (Object.keys(fieldErrors).length === 0) return;

    const first = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    /* No `aria-invalid` when the only problem is the category group — nothing
       there is a single control to focus, and its message sits beside the
       checkboxes where the eye already is. */
    if (!first) return;

    first.scrollIntoView({ block: "center", behavior: "smooth" });
    first.focus({ preventScroll: true });
  }, [fieldErrors]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    /* Clear this field's complaint as soon as it is touched. Leaving it under
       an input the operator has just rewritten makes a corrected field look
       still-broken, and they stop trusting the markers. */
    clearFieldError(key as string);
  }

  function clearFieldError(path: string) {
    setFieldErrors((current) => {
      if (!(path in current)) return current;
      const next = { ...current };
      delete next[path];
      return next;
    });
  }

  /**
   * Switching to "coming soon" also zeroes the stock field — the API rejects
   * a coming-soon book with stock (see `comingSoonHasNoStock` in
   * `@sakura/contracts`), and doing it here means the form never sends a
   * request the server would bounce.
   */
  function setAvailability(value: BookAvailability) {
    setForm((current) => ({
      ...current,
      availability: value,
      stockQuantity: value === "coming_soon" ? "0" : current.stockQuantity,
    }));
  }

  function toggleCategory(slug: string) {
    setForm((current) => ({
      ...current,
      categorySlugs: current.categorySlugs.includes(slug)
        ? current.categorySlugs.filter((s) => s !== slug)
        : [...current.categorySlugs, slug],
    }));
  }

  /**
   * Which required groups have nothing ticked.
   *
   * Derived from the fetched taxonomy rather than a hardcoded slug list, so
   * adding a sixth skill to the `categories` table needs no change here. If
   * the fetch failed, `categoryGroups` is empty and this reports nothing
   * missing — the form must not become unsubmittable because a taxonomy
   * request did not come back; the server still enforces the rule.
   */
  const missingGroups = REQUIRED_CATEGORY_GROUPS.filter(({ group }) => {
    const known = categoryGroups.find((candidate) => candidate.group === group);
    if (!known) return false;
    return !known.categories.some((category) => form.categorySlugs.includes(category.slug));
  });

  /**
   * What the banner says: the field summary when any field was rejected,
   * otherwise the whole-request message. Recomputed every render, so fixing a
   * field updates it rather than leaving a count that no longer holds.
   */
  const banner = Object.keys(fieldErrors).length > 0 ? summarise(fieldErrors) : error;

  async function submit(event: FormEvent) {
    event.preventDefault();

    if (missingGroups.length > 0) {
      const wanted = missingGroups.map((entry) => entry.label).join(" and one ");
      setError(null);
      setFieldErrors({ categorySlugs: `Pick at least one ${wanted}.` });
      return;
    }

    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      await onSubmit(toRequest(form));
    } catch (err) {
      /* Both the local pre-flight parse and the API raise AdminApiError with
         `fields`, so there is one branch here rather than one per source. See
         `validate` in lib/api/admin.ts. */
      if (err instanceof AdminApiError && err.fields.length > 0) {
        const byPath: Record<string, string> = {};
        for (const field of err.fields) {
          /* First issue per field wins: Zod can report several on one value
             ("expected int" and "too small"), and the first is the one that
             names the immediate problem. `path` is dotted for nested values —
             `galleryImageUrls.0` — so the head is what identifies the input. */
          const head = field.path.split(".")[0] || field.path;
          byPath[head] ??= humanise(head, field.code, field.message);
        }
        setFieldErrors(byPath);
        setError(null);
      } else if (err instanceof AdminApiError) {
        /* No field detail — a conflict on the slug, an expired session, an
           unreachable API. The server's own sentence is the best thing to
           show, and there is nothing to mark up. */
        setFieldErrors({});
        setError(err.message);
      } else {
        setFieldErrors({});
        setError("Could not save this book.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={(event) => void submit(event)} className="flex flex-col gap-8">
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Title"
          error={fieldErrors.title}
          required
          value={form.title}
          onChange={(event) => set("title", event.target.value)}
        />
        <Input
          label="Subtitle"
          error={fieldErrors.subtitle}
          value={form.subtitle}
          onChange={(event) => set("subtitle", event.target.value)}
        />
        <Input
          label="Authors (comma-separated)"
          error={fieldErrors.authorNames}
          required
          hint="New names are added to the author list automatically."
          value={form.authorNames}
          onChange={(event) => set("authorNames", event.target.value)}
        />
        <Input
          label="Publisher"
          error={fieldErrors.publisherName}
          required
          hint="New names are added automatically."
          value={form.publisherName}
          onChange={(event) => set("publisherName", event.target.value)}
        />
        <Input
          label="ISBN-10"
          error={fieldErrors.isbn10}
          value={form.isbn10}
          onChange={(event) => set("isbn10", event.target.value)}
        />
        <Input
          label="ISBN-13"
          error={fieldErrors.isbn13}
          value={form.isbn13}
          onChange={(event) => set("isbn13", event.target.value)}
        />
        <Input
          label="Edition"
          error={fieldErrors.edition}
          value={form.edition}
          onChange={(event) => set("edition", event.target.value)}
        />
        <Input
          label="Language"
          error={fieldErrors.language}
          value={form.language}
          onChange={(event) => set("language", event.target.value)}
        />
        <Input
          label="Published date"
          error={fieldErrors.publishedDate}
          type="date"
          hint={
            form.availability === "pre_order"
              ? "Doubles as the pre-order's expected ship date."
              : undefined
          }
          value={form.publishedDate}
          onChange={(event) => set("publishedDate", event.target.value)}
        />
        <Input
          label="Page count"
          error={fieldErrors.pageCount}
          type="number"
          min={1}
          value={form.pageCount}
          onChange={(event) => set("pageCount", event.target.value)}
        />
        <Input
          label="Weight (grams)"
          error={fieldErrors.weightGrams}
          type="number"
          min={1}
          value={form.weightGrams}
          onChange={(event) => set("weightGrams", event.target.value)}
        />
      </section>

      <Textarea
        label="Description"
        error={fieldErrors.description}
        required
        rows={5}
        value={form.description}
        onChange={(event) => set("description", event.target.value)}
      />

      {categoryGroups.length > 0 ? (
        <div>
          <p className="text-caption tracking-eyebrow text-muted mb-2 uppercase">Categories</p>
          {fieldErrors.categorySlugs ? (
            <p className="text-13.5 text-clay-deep mb-2">{fieldErrors.categorySlugs}</p>
          ) : null}
          <div className="flex flex-col gap-4">
            {categoryGroups.map((group) => {
              /* Skill and level are the two the book cannot be saved without,
                 so they are labelled as required and flagged when empty. Every
                 other group — `genre`, the vocabulary the catalog stopped
                 filtering on — is left as a plain optional row. */
              const required = REQUIRED_CATEGORY_GROUPS.find(
                (entry) => entry.group === group.group,
              );
              const unmet = required
                ? missingGroups.some((entry) => entry.group === group.group)
                : false;

              return (
                <div key={group.group ?? "ungrouped"}>
                  {group.group ? (
                    <p className="text-13.5 mb-1 capitalize">
                      <span className={unmet ? "text-clay-deep" : "text-secondary"}>
                        {required ? required.label : group.group}
                      </span>
                      {required ? (
                        <span className="text-clay" aria-hidden>
                          {" *"}
                        </span>
                      ) : null}
                    </p>
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
              );
            })}
          </div>
        </div>
      ) : null}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          label="Price (cents)"
          error={fieldErrors.priceCents}
          type="number"
          required
          min={0}
          /* Whole cents only. Without a step the browser accepts "12.50" in a
             field whose label says cents, the schema rejects the fraction, and
             the save fails on a value that looked perfectly reasonable to type.
             `step` makes the browser refuse it at the point of entry. */
          step={1}
          hint="Whole cents — 1200 is ৳12.00."
          value={form.priceCents}
          onChange={(event) => set("priceCents", event.target.value)}
        />
        <Input
          label="Compare-at price (cents)"
          error={fieldErrors.compareAtPriceCents}
          type="number"
          min={0}
          step={1}
          hint="Optional — whole cents, and higher than the price."
          value={form.compareAtPriceCents}
          onChange={(event) => set("compareAtPriceCents", event.target.value)}
        />
        <Input
          label="SKU"
          error={fieldErrors.sku}
          value={form.sku}
          onChange={(event) => set("sku", event.target.value)}
        />
        <Select
          label="Availability"
          error={fieldErrors.availability}
          hint={
            form.availability === "coming_soon"
              ? "Never orderable — stock is forced to 0."
              : form.availability === "pre_order"
                ? "Buyable now through the normal cart/checkout, ships later."
                : "A normal, in-stock book."
          }
          value={form.availability}
          onChange={(event) => setAvailability(event.target.value as BookAvailability)}
          options={[
            { value: "in_stock", label: "In stock" },
            { value: "pre_order", label: "Pre-order (ships later)" },
            { value: "coming_soon", label: "Coming soon (not orderable)" },
          ]}
        />
        <Input
          label="Stock quantity"
          error={fieldErrors.stockQuantity}
          type="number"
          min={0}
          disabled={form.availability === "coming_soon"}
          hint={
            form.availability === "pre_order"
              ? "The print run — checkout blocks once this hits 0."
              : undefined
          }
          value={form.stockQuantity}
          onChange={(event) => set("stockQuantity", event.target.value)}
        />
        <Input
          label="Low stock threshold"
          error={fieldErrors.lowStockThreshold}
          type="number"
          min={0}
          hint="Blank defaults to 5."
          value={form.lowStockThreshold}
          onChange={(event) => set("lowStockThreshold", event.target.value)}
        />
      </section>

      {form.availability === "pre_order" ? (
        <p className="text-13.5 text-secondary -mt-4">
          Published date above doubles as the &ldquo;ships around&rdquo; date shown to customers on
          the book page, cart line, and checkout.
        </p>
      ) : null}

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
            error={fieldErrors.coverImageUrl}
            required
            hint="Set automatically by the upload above — or paste one directly."
            value={form.coverImageUrl}
            onChange={(event) => set("coverImageUrl", event.target.value)}
          />
          <Input
            label="Cover image alt text"
            error={fieldErrors.coverImageAlt}
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
            error={fieldErrors.pdfUrl}
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
          error={fieldErrors.metaTitle}
          hint="SEO — leave blank to fall back to the title."
          value={form.metaTitle}
          onChange={(event) => set("metaTitle", event.target.value)}
        />
        <Input
          label="Meta description"
          error={fieldErrors.metaDescription}
          hint="SEO — leave blank to fall back to the description."
          value={form.metaDescription}
          onChange={(event) => set("metaDescription", event.target.value)}
        />
      </section>

      {banner ? (
        <p
          role="alert"
          className="rounded-control border-clay bg-tint text-13.5 text-clay-deep border px-4 py-3"
        >
          {banner}
        </p>
      ) : null}

      <div>
        <Button type="submit" loading={saving} loadingLabel="Saving">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
