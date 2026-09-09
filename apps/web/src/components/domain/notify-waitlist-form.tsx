"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { Badge, Button, Card, Input, Notice, Select } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { subscribeToWaitlist } from "@/lib/api/waitlist";
import { cn } from "@/lib/utils";

/* --------------------------------------------------------------------------
   NotifyWaitlistForm — the "we're not taking orders yet" catcher.

   Pre-orders are paused (see memory: preorder_stream_retired) but the inbox
   keeps filling with the same three questions. This form is the answer: name,
   phone, email and how many copies — just enough to reach the customer the
   moment stock lands.

   Every signup names a book — staff need to know what they're waiting on to
   act on the queue, so there is no "notify me about anything" option. The
   page decides which title(s) can be picked and never renders this form at
   all when nothing is currently offered.

   Posts straight to POST /waitlist. `source` names the entry point rather
   than being hardcoded into the request, so a future per-book "notify me"
   button can reuse this same form with a different source and a fixed
   `bookId` without a contract change.
   -------------------------------------------------------------------------- */

const waitlistSchema = z.object({
  bookId: z.string().uuid(),
  fullName: z.string().trim().min(2),
  phone: z
    .string()
    .trim()
    .regex(/^(\+?88)?01[3-9]\d{8}$/, "invalid"),
  email: z.string().trim().email(),
  quantity: z.number().int().min(1).max(20),
});

export type WaitlistValues = z.infer<typeof waitlistSchema>;

const waitlistDefaults: WaitlistValues = {
  bookId: "",
  fullName: "",
  phone: "",
  email: "",
  quantity: 1,
};

export type NotifyWaitlistFormProps = {
  /** BCP 47 tag the page is rendered under — sent so the eventual restock
   *  alert goes out in the language the customer actually reads. */
  locale: string;
  /**
   * Titles a customer can wait on, chosen by the page. The caller is expected
   * not to render this form at all when this is empty and there is no
   * `fixedBook` either — there is no "any book" fallback to fall back to.
   */
  books?: { id: string; title: string }[];
  /**
   * A single title every signup through this form is for, with no choice
   * offered — the picker is not drawn, the title is stated instead, and
   * `bookId` is submitted as this book.
   *
   * Distinct from a one-element `books`, which would still be a control asking
   * a question with one answer. Takes precedence over `books` when both are
   * given.
   */
  fixedBook?: { id: string; title: string } | null;
  /** Which entry point this form instance is — free text, stored as-is.
   *  Defaults to the one caller this component has today. */
  source?: string;
  className?: string;
};

export function NotifyWaitlistForm({
  locale,
  books = [],
  fixedBook = null,
  source = "restock-notify-page",
  className,
}: NotifyWaitlistFormProps) {
  const { t } = useTranslation();
  const [submitted, setSubmitted] = useState(false);
  const [alreadyListed, setAlreadyListed] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  /** The title on the confirmation, read back off the response rather than
   *  looked up locally — the server is what decided what was recorded. */
  const [listedFor, setListedFor] = useState<string | null>(null);

  /* The picker is drawn only when there is a choice to make: `fixedBook` means
     the book is already decided, so it is submitted from the default value and
     no control appears. */
  const choosable = fixedBook ? [] : books;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<WaitlistValues>({
    resolver: zodResolver(waitlistSchema),
    defaultValues: { ...waitlistDefaults, bookId: fixedBook?.id ?? "" },
    mode: "onBlur",
  });

  async function submit({ bookId, ...values }: WaitlistValues) {
    setSubmitError(null);

    try {
      const entry = await subscribeToWaitlist({
        ...values,
        bookId,
        locale,
        source,
      });

      setListedFor(entry.bookTitle);
      setSubmitted(true);
    } catch (err) {
      // A repeat signup from the same phone is a 409 ALREADY_EXISTS, not a
      // failure — the customer is already getting what they asked for, so
      // this renders the same confirmation rather than an error.
      if (err instanceof ApiError && err.code === "ALREADY_EXISTS") {
        /* No response body to read the title from, so this is the one place
           the local list is the source — it is also what they were just shown,
           so it cannot disagree with what they saw. */
        setListedFor(
          fixedBook?.id === bookId
            ? fixedBook.title
            : (choosable.find((book) => book.id === bookId)?.title ?? null),
        );
        setAlreadyListed(true);
        setSubmitted(true);
        return;
      }

      setSubmitError(err instanceof ApiError ? err.message : t("notify.form.submitError"));
    }
  }

  if (submitted) {
    return (
      <Card variant="tint" padding="roomy" className={cn("text-center", className)}>
        <Badge tone="accent" className="mx-auto">
          {t("notify.form.successBadge")}
        </Badge>
        <p className="text-22 text-ink mt-4 font-serif leading-tight">
          {t("notify.form.successTitle")}
        </p>
        <p className="text-body text-secondary max-w-measure-lede mx-auto mt-3">
          {alreadyListed ? t("notify.form.alreadyListedBody") : t("notify.form.successBody")}
        </p>

        {/* Names the title back to them. Worth its own line rather than being
            interpolated into the sentence above: the book is the fact they
            will want to check, and three languages' worth of grammar around
            an inserted title is a translation problem this avoids. */}
        {listedFor ? (
          <p className="text-13.5 text-ink mt-3 font-medium">
            {t("notify.form.listedFor", { book: listedFor })}
          </p>
        ) : null}
      </Card>
    );
  }

  return (
    <Card as="form" padding="roomy" className={className} onSubmit={handleSubmit(submit)}>
      {/* First field, and full width: which book is the question the customer
          came with, and asking it after their phone number reads as an
          afterthought. Absent entirely when there is nothing to choose between
          — nothing out of stock, or a `fixedBook` that has already decided.
          A picker whose options do not represent a real choice is a control
          that only asks people to wonder what it is for. */}
      {choosable.length > 0 ? (
        <div className="mb-5">
          <Select
            label={t("notify.form.book")}
            hint={t("notify.form.bookHint")}
            error={errors.bookId ? t("notify.form.bookError") : undefined}
            {...register("bookId")}
          >
            {/* No pre-selected value: an untouched form submits "", which
                fails the schema's uuid check and is caught by validation
                rather than silently joining a list nobody chose. */}
            <option value="" disabled>
              {t("notify.form.bookPlaceholder")}
            </option>
            {choosable.map((book) => (
              <option key={book.id} value={book.id}>
                {book.title}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      {/* One title on offer is not a question, but it is still a fact the
          customer has to be told: they are joining a list *for a book*, and a
          form that submits a title it never names asks people to trust a
          choice they cannot see. A stated line rather than a disabled
          `<select>` — a control that cannot be operated is a worse way to say
          "this is already decided" than a sentence is. */}
      {fixedBook ? (
        <div className="rounded-control border-rule mb-5 border px-4 py-3">
          <p className="text-caption text-secondary">{t("notify.form.book")}</p>
          <p className="text-13.5 text-ink mt-1 font-medium">{fixedBook.title}</p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Input
          label={t("notify.form.fullName")}
          error={errors.fullName ? t("notify.form.fullNameError") : undefined}
          {...register("fullName")}
        />

        <Input
          label={t("notify.form.phone")}
          hint={t("notify.form.phoneHint")}
          inputMode="tel"
          error={errors.phone ? t("notify.form.phoneError") : undefined}
          {...register("phone")}
        />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Input
          type="email"
          label={t("notify.form.email")}
          error={errors.email ? t("notify.form.emailError") : undefined}
          {...register("email")}
        />

        <Input
          type="number"
          min={1}
          max={20}
          label={t("notify.form.quantity")}
          error={errors.quantity ? t("notify.form.quantityError") : undefined}
          {...register("quantity", { valueAsNumber: true })}
        />
      </div>

      <p className="text-caption text-secondary mt-6">{t("notify.form.reassurance")}</p>

      {Object.keys(errors).length > 0 ? (
        <Notice tone="error" className="mt-4">
          {t("notify.form.errorSummary")}
        </Notice>
      ) : null}

      {submitError ? (
        <Notice tone="error" className="mt-4">
          {submitError}
        </Notice>
      ) : null}

      <Button
        type="submit"
        block
        loading={isSubmitting}
        loadingLabel={t("notify.form.submitting")}
        className="mt-6"
      >
        {t("notify.form.submit")}
      </Button>
    </Card>
  );
}
