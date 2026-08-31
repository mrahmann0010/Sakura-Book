"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { REVIEW_BODY_MAX, REVIEW_BODY_MIN } from "@sakura/contracts";
import { useCallback, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { Button, Input, LinkButton, Notice } from "@/components/ui";
import { ApiError } from "@/lib/api/client";
import { submitReview } from "@/lib/api/reviews";
import { cn } from "@/lib/utils";

/* --------------------------------------------------------------------------
   ReviewForm — a customer's testimonial about the service.

   About the shop: ordering, delivery, payment, support. Not about a book, and
   there is no book field here for the same reason there is none in the
   contract — per-title reviews are a different thing with a different home.

   Built to the wireframe, whose one rule is that the box is the page: the
   review is the only required field and the only control on screen until
   there is something in it. Name and email appear once the person is already
   writing, because a screen that opens with empty boxes asks to be filled in
   rather than written in.

   Nothing this form posts is ever public: the API always writes PENDING, and
   the thank-you says a person reads it first — said before submit as well as
   after, so nobody is surprised by the wait.
   -------------------------------------------------------------------------- */

/**
 * The browser-side mirror of `reviewSubmitRequestSchema`, in the shapes the
 * DOM actually produces: every control here holds a string, so the optional
 * fields are modelled as "" rather than `undefined` and translated at the
 * call. Modelling them as optional would mean the resolver and the inputs
 * disagreeing about the same field.
 *
 * The length bounds come from the contract rather than being retyped, so the
 * form cannot start disagreeing with the server about what is too short.
 */
const reviewFormSchema = z.object({
  authorName: z.string().trim().max(80),
  authorEmail: z.union([z.literal(""), z.string().trim().max(254).email()]),
  rating: z.string(),
  body: z.string().trim().min(REVIEW_BODY_MIN).max(REVIEW_BODY_MAX),
  /* The honeypot. Hidden from people, filled by form-scraping bots, and
     required to stay empty — the server drops a filled one silently. */
  website: z.string().max(0),
});

export type ReviewFormValues = z.infer<typeof reviewFormSchema>;

const reviewDefaults: ReviewFormValues = {
  authorName: "",
  authorEmail: "",
  rating: "",
  body: "",
  website: "",
};

const RATINGS = [1, 2, 3, 4, 5] as const;

export type ReviewFormProps = {
  /** Where "back to the books" goes from the thank-you. */
  catalogHref: string;
  /** Where "track an order" goes from the thank-you. */
  ordersHref: string;
  className?: string;
};

/**
 * A five-pointed star with a fatter body and blunt, rounded points — closer to
 * something drawn by hand than the sharp app-store glyph.
 *
 * The softness is not in the path alone: the outline is stroked with round
 * joins and caps at the same colour as the fill, which thickens the shape and
 * rounds every corner. That is also why one path serves both states — unfilled
 * is the same star with `fill: none`, so the empty and full stars are exactly
 * the same size and sit on exactly the same centres.
 *
 * `currentColor` throughout, so the caller sets the state with a text colour
 * and dark mode follows the token without this component knowing about either.
 */
function SoftStar({ filled, className }: { filled: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <path d="M12 3.6 15.2 8 20.3 9.7 17.1 14 17.1 19.4 12 17.7 6.9 19.4 6.9 14 3.7 9.7 8.8 8Z" />
    </svg>
  );
}

export function ReviewForm({ catalogHref, ordersHref, className }: ReviewFormProps) {
  const { t } = useTranslation();
  const [submitError, setSubmitError] = useState<string | null>(null);
  /** The score the pointer or keyboard focus is currently over; 0 for none. */
  const [hovered, setHovered] = useState(0);
  /** Whether the pointer is over the submit button — reaching for it. */
  const [reaching, setReaching] = useState(false);
  /**
   * What was sent, kept for the thank-you's read-only echo.
   *
   * Null is the "not submitted yet" state and is what the whole screen
   * branches on, rather than a separate boolean: the echo and the swap are
   * the same fact, and two flags could disagree.
   */
  const [sent, setSent] = useState<ReviewFormValues | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const {
    control,
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ReviewFormValues>({
    resolver: zodResolver(reviewFormSchema),
    defaultValues: reviewDefaults,
    mode: "onBlur",
  });

  /* `useWatch` rather than the form's `watch()`: the latter returns a function
     React Compiler cannot memoize, so reading through it opts this whole
     component out of compilation. */
  const body = useWatch({ control, name: "body" }) ?? "";
  const rating = useWatch({ control, name: "rating" }) ?? "";

  /* Counted the way the server counts it — trimmed — so a box of spaces does
     not read as twenty characters written. */
  const bodyLength = body.trim().length;
  const hasBody = body.length > 0;
  const canSubmit = bodyLength >= REVIEW_BODY_MIN;

  /** Grows the box with the text, so nothing a person wrote scrolls out of view. */
  const fitToContent = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;

    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  /* register() owns the ref; this keeps our own copy alongside it rather than
     replacing it, which would leave RHF unable to focus the field on error. */
  const bodyField = register("body");

  async function submit(values: ReviewFormValues) {
    setSubmitError(null);

    try {
      await submitReview({
        /* Empty optionals are omitted, not sent as "": the contract's
           `.min(1)` on a name and `.email()` on an address would both reject
           a blank string, which is the most common case on this form. */
        ...(values.authorName ? { authorName: values.authorName } : {}),
        ...(values.authorEmail ? { authorEmail: values.authorEmail } : {}),
        ...(values.rating ? { rating: Number(values.rating) } : {}),
        body: values.body,
      });

      setSent(values);
    } catch (err) {
      /* The endpoint is throttled — an unauthenticated write anyone can reach.
         A 429 is not a failure the customer caused, so it gets its own line
         rather than "something went wrong on our end". */
      if (err instanceof ApiError && err.status === 429) {
        setSubmitError(t("reviews.form.throttledError"));
        return;
      }

      setSubmitError(err instanceof ApiError ? err.message : t("reviews.form.submitError"));
    }
  }

  /* The thank-you replaces the form in place rather than navigating: the
     person is done, and a new URL would put a page they cannot go back from
     into their history. */
  if (sent) {
    return (
      <section className={cn("flex flex-col items-center gap-4 text-center", className)}>
        <span
          aria-hidden="true"
          className="border-rule bg-tint text-ink text-18 flex size-14 items-center justify-center rounded-full border"
        >
          ✓
        </span>

        <h2 className="text-28 lg:text-32 text-ink mt-2 font-serif leading-tight">
          {t("reviews.form.successTitle")}
        </h2>

        <p className="text-body">{t("reviews.form.successBody")}</p>

        {/* What they sent, read back to them. Not a courtesy: it is the only
            record they get, since nothing is published yet and there is no
            account to look it up in later. */}
        <div className="border-rule bg-tint rounded-container mt-6 w-full border p-5 text-center">
          <p className="eyebrow">{t("reviews.form.successSentLabel")}</p>

          <p className="text-body mt-4 whitespace-pre-wrap">{sent.body}</p>

          {/* The same stars they clicked, read-only — a line of text saying
              "4 out of 5" would not obviously be the thing they just set.
              Labelled for screen readers, since the row itself is decorative
              once it can no longer be changed. */}
          {sent.rating ? (
            <p
              className="mt-4 flex justify-center gap-0.5"
              aria-label={t("reviews.form.ratingStars", { stars: sent.rating })}
            >
              {RATINGS.map((stars) => (
                <SoftStar
                  key={stars}
                  filled={stars <= Number(sent.rating)}
                  className={cn("size-5", stars <= Number(sent.rating) ? "text-clay" : "text-rule")}
                />
              ))}
            </p>
          ) : null}
        </div>

        <div className="mt-6 flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:justify-center">
          <LinkButton href={catalogHref}>{t("reviews.form.successBackToBooks")}</LinkButton>
          <LinkButton href={ordersHref} variant="secondary">
            {t("reviews.form.successTrackOrder")}
          </LinkButton>
        </div>
      </section>
    );
  }

  return (
    <form className={className} onSubmit={handleSubmit(submit)} noValidate>
      {/* The box is the page, and now the first thing on it: no prompts, no
          categories, nothing to read before writing. The counter lives inside
          the border rather than under it, so the frame reads as one object and
          the count belongs to the text instead of floating between fields. */}
      <div
        className={cn(
          "rounded-container bg-surface border transition-colors duration-150",
          "focus-within:border-ink",
          errors.body ? "border-clay" : "border-rule",
        )}
      >
        <label htmlFor="review-body" className="sr-only">
          {t("reviews.form.body")}
        </label>

        <textarea
          id="review-body"
          rows={5}
          maxLength={REVIEW_BODY_MAX}
          placeholder={t("reviews.form.bodyPlaceholder")}
          aria-describedby="review-body-count"
          aria-invalid={errors.body ? true : undefined}
          className="text-body placeholder:text-muted block w-full resize-none bg-transparent px-5 pt-5 pb-3 focus:outline-none"
          {...bodyField}
          ref={(el) => {
            bodyField.ref(el);
            textareaRef.current = el;
          }}
          onChange={(event) => {
            void bodyField.onChange(event);
            fitToContent();
          }}
        />

        <div className="border-rule flex items-center justify-between gap-4 border-t px-5 py-3">
          {/* The floor is stated as a hint while it matters and disappears
              once it is met — a rule you have already satisfied is noise. */}
          <p className="text-caption text-secondary">
            {canSubmit ? " " : t("reviews.form.bodyHint", { min: REVIEW_BODY_MIN })}
          </p>

          <p id="review-body-count" className="text-caption text-muted tabular-nums">
            {t("reviews.form.bodyCount", { current: bodyLength, max: REVIEW_BODY_MAX })}
          </p>
        </div>
      </div>

      {/* Under the text, never above it: a score is a summary, and asking for
          one first is asking someone to conclude before they have thought.
          Defaults to none, and stays clearable — plenty of people have
          something to say without wanting to mark it out of five. */}
      <fieldset className="mt-8 w-full">
        <legend className="eyebrow mb-3 w-full text-center">{t("reviews.form.rating")}</legend>

        <div
          className="flex items-center justify-center gap-0.5"
          onPointerLeave={() => setHovered(0)}
        >
          {RATINGS.map((stars) => {
            const chosen = rating === "" ? 0 : Number(rating);
            /* Hover previews the score it would set, so the whole row answers
               "what am I about to pick" before the click rather than after. */
            const shown = hovered || chosen;
            const filled = stars <= shown;
            const previewing = hovered > 0 && chosen !== hovered;

            return (
              <button
                key={stars}
                type="button"
                aria-pressed={chosen === stars}
                aria-label={t("reviews.form.ratingStars", { stars })}
                onPointerEnter={() => setHovered(stars)}
                onFocus={() => setHovered(stars)}
                onBlur={() => setHovered(0)}
                onClick={() =>
                  /* Clicking the current score clears it — the only way back
                     to "no rating" for someone who set one by accident, short
                     of the clear link, and the one people try first. */
                  setValue("rating", chosen === stars ? "" : String(stars), {
                    shouldValidate: true,
                  })
                }
                className="focus-visible:outline-clay grid size-11 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 sm:size-10"
              >
                <SoftStar
                  className={cn(
                    "size-7 transition-colors duration-150",
                    filled ? (previewing ? "text-clay/45" : "text-clay") : "text-rule",
                  )}
                  filled={filled}
                />
              </button>
            );
          })}

          {rating !== "" ? (
            <button
              type="button"
              onClick={() => setValue("rating", "", { shouldValidate: true })}
              className="text-caption text-secondary hover:text-ink ml-2 underline underline-offset-4"
            >
              {t("reviews.form.ratingClear")}
            </button>
          ) : null}
        </div>
      </fieldset>

      {/* Revealed once there is something to attribute. Rendered rather than
          hidden with CSS so the tab order matches what is on screen. */}
      {hasBody ? (
        <div className="border-rule mt-8 border-t pt-7">
          <p className="eyebrow text-center">{t("reviews.form.optionalHeading")}</p>

          {/* No headline field. The contract still carries `title` and the
              admin queue still shows it, so a testimonial that arrived with
              one keeps it — this form just never asks. Writing a headline is
              a second, harder piece of writing on top of the review itself,
              and the one that most often stops people finishing.

              Who they are, on one row: the two fields a person fills in the
              same breath, and the two whose hints have to be read together —
              one is published, the other never is. */}
          <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Input
              label={t("reviews.form.authorName")}
              hint={t("reviews.form.authorNameHint")}
              error={errors.authorName ? t("reviews.form.authorNameError") : undefined}
              {...register("authorName")}
            />

            <Input
              type="email"
              label={t("reviews.form.authorEmail")}
              hint={t("reviews.form.authorEmailHint")}
              error={errors.authorEmail ? t("reviews.form.authorEmailError") : undefined}
              {...register("authorEmail")}
            />
          </div>
        </div>
      ) : null}

      {/* Hidden from people and from screen readers, left in the DOM for the
          bots that fill every input they find. `tabIndex={-1}` keeps it out of
          the keyboard path so nobody can land in it by accident. */}
      <div className="hidden" aria-hidden="true">
        <input
          type="text"
          tabIndex={-1}
          autoComplete="off"
          placeholder="Website"
          {...register("website")}
        />
      </div>

      {submitError ? (
        <Notice tone="error" className="mt-6">
          {submitError}
        </Notice>
      ) : null}

      {/* Disabled until the floor is met, and the reason is only shown to
          someone who goes looking for it — reaching for a button that will not
          move is the moment the answer is wanted, and until then a standing
          line of small print about a rule nobody has hit is just noise.

          The handlers sit on the wrapper rather than the button: a disabled
          button fires no pointer events, so hovering it would otherwise say
          nothing at all. */}
      <div className="mt-8 flex justify-center">
        <span
          className="relative inline-flex w-full justify-center sm:w-auto"
          onPointerEnter={() => setReaching(true)}
          onPointerLeave={() => setReaching(false)}
        >
          {!canSubmit && reaching ? (
            <span
              role="tooltip"
              className="bg-ink text-surface text-caption rounded-control absolute bottom-full left-1/2 mb-2.5 -translate-x-1/2 px-3 py-1.5 whitespace-nowrap"
            >
              {t("reviews.form.submitHint", { min: REVIEW_BODY_MIN })}
            </span>
          ) : null}

          <Button
            type="submit"
            disabled={!canSubmit}
            loading={isSubmitting}
            loadingLabel={t("reviews.form.submitting")}
            /* Always described by the rule, not only while the tooltip is up:
               a screen reader announcing a disabled button needs to say why,
               and it has no hover to trigger. */
            aria-describedby={canSubmit ? undefined : "submit-hint"}
            className="w-full sm:w-auto"
          >
            {t("reviews.form.submit")}
          </Button>

          {!canSubmit ? (
            <span id="submit-hint" className="sr-only">
              {t("reviews.form.submitHint", { min: REVIEW_BODY_MIN })}
            </span>
          ) : null}
        </span>
      </div>

      {/* Said before submit, not only after. Someone deciding whether to
          bother should know their words are read by a person first. */}
      <p className="border-rule text-caption text-secondary mx-auto mt-8 border-t pt-6 text-center">
        {t("reviews.form.moderationNote")}
      </p>
    </form>
  );
}
