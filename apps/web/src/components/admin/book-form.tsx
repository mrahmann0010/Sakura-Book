"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
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
import { fileUrl } from "@/lib/storage-url";

/* Lazy for the same reason the storefront's is: pdf.js is a large chunk, and
   most visits to this form are editing a price, not re-checking a sample. */
const PdfReader = dynamic(() => import("@/components/domain/pdf-reader").then((m) => m.PdfReader), {
  ssr: false,
});

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
  /** Taka as typed — "399", "399.50". Converted to cents on submit. */
  priceTaka: string;
  compareAtPriceTaka: string;
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
  priceTaka: "",
  compareAtPriceTaka: "",
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
    priceTaka: takaFromCents(book.priceCents),
    compareAtPriceTaka:
      book.compareAtPriceCents === null ? "" : takaFromCents(book.compareAtPriceCents),
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
  priceCents: "Price",
  compareAtPriceCents: "Compare-at price",
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

/* --------------------------------------------------------------------------
   Money

   The form takes taka; the API, the database and every price on the storefront
   are minor units. The fields used to be labelled "(cents)" and to pass the
   number through untouched, which meant typing 399 for a ৳399 book priced it
   at ৳3.99 — and typing a price and a "was" price in the obvious order made
   compare-at lower than price, which the schema refuses. Both were the same
   mistake: asking an operator to do the ×100 in their head.

   The conversion lives here and only here. `priceCents` remains the name on
   the wire, so nothing downstream changes.
   -------------------------------------------------------------------------- */

/** "399.5" → 39950. Rounded, because 39950.000000001 is a float artefact. */
function centsFromTaka(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const taka = Number(trimmed);
  return Number.isFinite(taka) ? Math.round(taka * 100) : undefined;
}

/**
 * 39950 → "399.5", and 39900 → "399".
 *
 * Trailing zeros are dropped so a whole-taka price comes back into the form as
 * the operator typed it rather than as "399.00", which reads as a value
 * someone else set.
 */
function takaFromCents(cents: number): string {
  return String(cents / 100);
}

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
  /* Not the money fields: those are typed in taka and converted, so a decimal
     there is expected and `centsFromTaka` makes the result whole. */
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
    priceCents: centsFromTaka(form.priceTaka) ?? Number.NaN,
    compareAtPriceCents: centsFromTaka(form.compareAtPriceTaka),
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

  /**
   * Whether the taxonomy arrived.
   *
   * It used to be fetched and the failure swallowed, on the reasoning that
   * "this only degrades the checkbox list, it does not block saving a book".
   * That stopped being true the moment a skill and a JLPT level became
   * required: with the fetch failed there were no boxes to tick, the section
   * rendered as nothing at all, and the only thing on screen was a validation
   * error demanding a choice the form gave no way to make. Losing the API for
   * a moment turned the page into a dead end that explained nothing.
   */
  const [categoryState, setCategoryState] = useState<"loading" | "ready" | "failed">("loading");
  const [categoryError, setCategoryError] = useState<string | null>(null);

  /**
   * The fetch alone, with no synchronous state write, so the mount effect can
   * call it without kicking off a cascading render — `categoryState` already
   * starts at "loading", so there is nothing for the first run to set.
   */
  const fetchCategories = useCallback(() => {
    getCategories()
      .then((groups) => {
        setCategoryGroups(groups);
        setCategoryState("ready");
      })
      .catch((err: unknown) => {
        setCategoryState("failed");
        /* The API's own words when it gave any — most often it did not answer
           at all, which is the case worth naming, because the fix is to start
           it rather than to keep pressing Save. */
        setCategoryError(err instanceof Error ? err.message : null);
      });
  }, []);

  /** The Retry button's job: reset to loading, then go again. */
  const retryCategories = useCallback(() => {
    setCategoryState("loading");
    setCategoryError(null);
    fetchCategories();
  }, [fetchCategories]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

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
  /**
   * Required groups the taxonomy does not describe at all.
   *
   * Distinct from "nothing ticked": the fetch succeeded and simply came back
   * without a `skill` or `level` group, which is what an unseeded `categories`
   * table looks like from here — a 200 carrying `[]`. That rendered as a
   * heading with nothing under it and a validation error demanding a choice
   * the page could not offer, which is indistinguishable from a broken form.
   */
  const absentGroups = REQUIRED_CATEGORY_GROUPS.filter(
    ({ group }) => !categoryGroups.some((candidate) => candidate.group === group),
  );

  const missingGroups = REQUIRED_CATEGORY_GROUPS.filter(({ group }) => {
    const known = categoryGroups.find((candidate) => candidate.group === group);
    /* A group the taxonomy never described cannot be judged. Reporting it as
       satisfied is what let the form post an empty `categorySlugs` and bounce
       off the schema with a message the operator could not act on; the submit
       guard below refuses outright while the list is missing, which is both
       true and fixable. */
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

    /* Refuse before the schema does. The schema's own message — "Pick a skill
       and a JLPT level" — is correct and useless when the list those come from
       never loaded, because there is nothing on screen to pick. */
    if (categoryState !== "ready") {
      setFieldErrors({});
      setError(
        categoryState === "loading"
          ? "Still loading the category list — give it a moment and try again."
          : "The category list could not be loaded, so a skill and a JLPT level cannot be chosen. Retry it under Categories, then save.",
      );
      return;
    }

    if (categoryState === "ready" && absentGroups.length > 0) {
      setFieldErrors({});
      setError(
        `The category list has no ${absentGroups.map((entry) => entry.label).join(" and no ")} to choose from, ` +
          "so this cannot be saved. The reference data needs seeding — see the note under Categories.",
      );
      return;
    }

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
      if (err instanceof AdminApiError && err.code === "RESPONSE_INVALID") {
        /* The write landed and only the reply was unreadable, so the one thing
           not to say is "it failed" — that sends the operator back to Save and
           creates a second copy of the book. */
        setFieldErrors({});
        setError(
          "This may have saved — the API accepted it but replied in an unexpected shape. " +
            "Check the books list before trying again.",
        );
      } else if (err instanceof AdminApiError && err.fields.length > 0) {
        const byPath: Record<string, string> = {};
        /* Issues with no path are about the request as a whole — a refine
           across two fields that names neither. They have no input to sit
           under, so they go to the banner; keying them by "" would render a
           field error under an empty label. */
        const general: string[] = [];

        for (const field of err.fields) {
          /* First issue per field wins: Zod can report several on one value
             ("expected int" and "too small"), and the first is the one that
             names the immediate problem. `path` is dotted for nested values —
             `galleryImageUrls.0` — so the head is what identifies the input. */
          const head = field.path.split(".")[0];
          if (!head) {
            general.push(field.message);
            continue;
          }
          byPath[head] ??= humanise(head, field.code, field.message);
        }

        setFieldErrors(byPath);
        /* Only when nothing could be pinned to a field does the banner carry
           the general text; otherwise `banner` derives from the field errors
           and naming them is more useful. */
        setError(Object.keys(byPath).length === 0 ? general.join(" ") : null);
      } else if (err instanceof AdminApiError) {
        /* No field detail — a slug conflict, an expired session, an
           unreachable API. The server's own sentence is the best thing to
           show, and there is nothing to mark up. */
        setFieldErrors({});
        setError(err.message);
      } else {
        /* Genuinely unexpected now that transport and response failures both
           arrive as AdminApiError. Logged, because a message this vague is not
           something anyone can act on without the console. */
        console.error("Unexpected failure saving a book", err);
        setFieldErrors({});
        setError("Could not save this book — see the browser console for details.");
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
          hint="Text · required. The URL slug is built from this."
          error={fieldErrors.title}
          required
          value={form.title}
          onChange={(event) => set("title", event.target.value)}
        />
        <Input
          label="Subtitle"
          hint="Text · optional."
          error={fieldErrors.subtitle}
          value={form.subtitle}
          onChange={(event) => set("subtitle", event.target.value)}
        />
        <Input
          label="Authors (comma-separated)"
          error={fieldErrors.authorNames}
          required
          hint="Text, comma-separated · required. New names are added automatically."
          value={form.authorNames}
          onChange={(event) => set("authorNames", event.target.value)}
        />
        <Input
          label="Publisher"
          error={fieldErrors.publisherName}
          required
          hint="Text · required. New names are added automatically."
          value={form.publisherName}
          onChange={(event) => set("publisherName", event.target.value)}
        />
        <Input
          label="ISBN-10"
          hint="10 characters · optional."
          error={fieldErrors.isbn10}
          value={form.isbn10}
          onChange={(event) => set("isbn10", event.target.value)}
        />
        <Input
          label="ISBN-13"
          hint="13 characters · optional."
          error={fieldErrors.isbn13}
          value={form.isbn13}
          onChange={(event) => set("isbn13", event.target.value)}
        />
        <Input
          label="Edition"
          hint="Text · optional. e.g. First edition."
          error={fieldErrors.edition}
          value={form.edition}
          onChange={(event) => set("edition", event.target.value)}
        />
        <Input
          label="Language"
          hint="Two-letter code · optional. bn, en or ja. Blank means en."
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
              ? "Date · doubles as the pre-order's expected ship date."
              : "Date · optional."
          }
          value={form.publishedDate}
          onChange={(event) => set("publishedDate", event.target.value)}
        />
        <Input
          label="Page count"
          hint="Whole number · optional."
          error={fieldErrors.pageCount}
          type="number"
          min={1}
          value={form.pageCount}
          onChange={(event) => set("pageCount", event.target.value)}
        />
        <Input
          label="Weight (grams)"
          hint="Whole number · optional. Grams, not kilograms."
          error={fieldErrors.weightGrams}
          type="number"
          min={1}
          value={form.weightGrams}
          onChange={(event) => set("weightGrams", event.target.value)}
        />
      </section>

      <Textarea
        label="Description"
        hint="Text · required. Shown in full on the book page."
        error={fieldErrors.description}
        required
        rows={5}
        value={form.description}
        onChange={(event) => set("description", event.target.value)}
      />

      {/* Always rendered, whatever happened to the fetch. Two of these groups
          are required, and a required control that disappears when a request
          fails leaves nothing to act on but a validation error. */}
      <div>
        <p className="text-caption tracking-eyebrow text-muted mb-2 uppercase">Categories</p>
        {fieldErrors.categorySlugs ? (
          <p className="text-13.5 text-clay-deep mb-2">{fieldErrors.categorySlugs}</p>
        ) : (
          <p className="text-13.5 text-muted mb-2">
            Tick boxes · at least one Skill and one JLPT Level are required. Genre is optional.
          </p>
        )}

        {categoryState === "loading" ? (
          <p className="text-13.5 text-muted">Loading the category list…</p>
        ) : null}

        {categoryState === "ready" && absentGroups.length > 0 ? (
          <div className="rounded-control border-clay bg-tint border px-4 py-3">
            <p className="text-13.5 text-clay-deep">
              The category list loaded, but it has no{" "}
              {absentGroups.map((entry) => entry.label).join(" and no ")} in it — so there is
              nothing to tick, and a book cannot be saved without one of each.
            </p>
            <p className="text-13.5 text-secondary mt-1">
              These are seeded reference data, not something this form creates. Whoever administers
              the database needs to restore them.
            </p>
          </div>
        ) : null}

        {categoryState === "failed" ? (
          <div className="rounded-control border-clay bg-tint border px-4 py-3">
            <p className="text-13.5 text-clay-deep">
              Could not load the category list, so there is nothing to tick yet.
              {categoryError ? ` ${categoryError}` : ""}
            </p>
            <p className="text-13.5 text-secondary mt-1">
              This list comes from the API — if it is not running, start it and retry.
            </p>
            <div className="mt-3">
              <Button type="button" variant="secondary" size="sm" onClick={retryCategories}>
                Retry
              </Button>
            </div>
          </div>
        ) : null}

        {/* Inside the same block as the heading above, not a sibling of it —
            the form is a `gap-8` column, so a separate element would sit 32px
            below its own label and read as an unrelated section. */}
        {categoryGroups.length > 0 ? (
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
        ) : null}
      </div>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          label="Price (৳)"
          /* The error is keyed by the wire field, `priceCents`, whatever the
             label above it says. */
          error={fieldErrors.priceCents}
          type="number"
          required
          min={0}
          /* Two decimal places, because that is what taka has. The field used
             to be cents at `step={1}`, which is what turned a perfectly
             reasonable "399" into ৳3.99. */
          step="0.01"
          hint="Taka · required. What the customer pays — 399 or 399.50."
          value={form.priceTaka}
          onChange={(event) => set("priceTaka", event.target.value)}
        />
        <Input
          label="Compare-at price (৳)"
          error={fieldErrors.compareAtPriceCents}
          type="number"
          min={0}
          step="0.01"
          hint="Taka · optional. The struck-through “was” price, so it must be higher than the price above."
          value={form.compareAtPriceTaka}
          onChange={(event) => set("compareAtPriceTaka", event.target.value)}
        />
        <Input
          label="SKU"
          hint="Text · optional. Your own stock code, if you use one."
          error={fieldErrors.sku}
          value={form.sku}
          onChange={(event) => set("sku", event.target.value)}
        />
        <Select
          label="Availability"
          error={fieldErrors.availability}
          hint={
            form.availability === "coming_soon"
              ? "Pick one · never orderable, and stock is forced to 0."
              : form.availability === "pre_order"
                ? "Pick one · buyable now through the normal checkout, ships later."
                : "Pick one · a normal, in-stock book."
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
          /* The pre-order wording replaces the generic line rather than sitting
             beside it — one field, one hint, and on a pre-order the print run
             is the more useful thing to say. */
          hint={
            form.availability === "pre_order"
              ? "Whole number · the print run. Checkout blocks once this hits 0."
              : "Whole number · optional. Blank means 0."
          }
          value={form.stockQuantity}
          onChange={(event) => set("stockQuantity", event.target.value)}
        />
        <Input
          label="Low stock threshold"
          error={fieldErrors.lowStockThreshold}
          type="number"
          min={0}
          hint="Whole number · optional. Blank means 5."
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
            hint="JPEG, PNG or WebP · up to 8MB. Fills the URL field below."
            uploadFn={uploadAdminCover}
            onUploaded={(result) => set("coverImageUrl", result.url)}
          />
          <Input
            label="Cover image URL"
            error={fieldErrors.coverImageUrl}
            required
            hint="URL · required. Set by the upload above, or paste a link."
            value={form.coverImageUrl}
            onChange={(event) => set("coverImageUrl", event.target.value)}
          />
          <Input
            label="Cover image alt text"
            hint="Text · optional. Describes the cover to a screen reader."
            error={fieldErrors.coverImageAlt}
            value={form.coverImageAlt}
            onChange={(event) => set("coverImageAlt", event.target.value)}
          />
          {/* Proxied for the preview, while the field above keeps the raw
              stored URL. The two must differ: the input is what gets saved, and
              rewriting it would put an `/api/files/…` path in the database that
              nothing could resolve back to an object. See lib/storage-url.ts. */}
          {form.coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- an admin-supplied/external URL, not a Next-optimized asset
            <img
              src={fileUrl(form.coverImageUrl) ?? undefined}
              alt=""
              className="rounded-control border-rule h-40 w-28 border object-cover"
            />
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          <FileUpload
            label="Sample PDF"
            accept="application/pdf"
            hint="PDF · up to 40MB. A sample chapter, not the whole book."
            uploadFn={uploadAdminPdf}
            onUploaded={(result) => {
              set("pdfUrl", result.url);
              if (result.fileName) set("pdfFileName", result.fileName);
            }}
          />
          <Input
            label="PDF URL"
            error={fieldErrors.pdfUrl}
            hint="URL · optional. A sample chapter, not the full book — this is what the Preview button opens."
            value={form.pdfUrl}
            onChange={(event) => set("pdfUrl", event.target.value)}
          />
          {form.pdfUrl ? (
            <>
              {/* The same reader the storefront uses, not an <iframe>, for two
                  reasons: the iframe was blank on any phone (see
                  pdf-reader.tsx), and an admin checking an upload should be
                  looking at what a shopper will actually see rather than at
                  whatever viewer this particular desktop happens to ship. */}
              <PdfReader
                url={fileUrl(form.pdfUrl) ?? form.pdfUrl}
                className="rounded-control border-rule h-64 w-full border"
              />
              <a
                href={fileUrl(form.pdfUrl) ?? form.pdfUrl}
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

      <section className="flex flex-col gap-2">
        <p className="text-13.5 text-muted">
          Yes/no · Active shows the book on the storefront, Featured marks it for the landing shelf.
        </p>
        <div className="flex flex-wrap gap-6">
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
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Meta title"
          error={fieldErrors.metaTitle}
          hint="Text · optional. Blank falls back to the title."
          value={form.metaTitle}
          onChange={(event) => set("metaTitle", event.target.value)}
        />
        <Input
          label="Meta description"
          error={fieldErrors.metaDescription}
          hint="Text · optional. Blank falls back to the description."
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
