"use client";

import { useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { COUPON_REJECTION_REASONS, type CouponRejectionReason } from "@sakura/contracts";

import { Button, Eyebrow, Input } from "@/components/ui";
import { formatMoney } from "@/lib/money";

/* --------------------------------------------------------------------------
   The coupon box — only on the temporary coupon checkout (/checkout/coupon).

   It holds no pricing of its own. "Apply" hands the code up; the page sends
   it with the next cart quote, and whether it applied, and for how much, is
   read straight back off that quote. So the discount on screen is always the
   one the server will charge, and a code that stops applying (quantity
   lowered under its minimum, say) shows as refused rather than as a discount
   the order will not get.

   Deliberately not a <form>: it sits inside the checkout form, and nested
   forms are invalid HTML. Enter is caught by hand so it applies the code
   instead of submitting the order.
   -------------------------------------------------------------------------- */

function isKnownReason(reason: string): reason is CouponRejectionReason {
  return (COUPON_REJECTION_REASONS as readonly string[]).includes(reason);
}

export function CouponField({
  appliedCode,
  coupon,
  rejection,
  checking,
  money,
  onApply,
  onRemove,
}: {
  /** The code last handed up, accepted or not. Null when none is entered. */
  appliedCode: string | null;
  /** What the current quote applied — the source of truth for the discount. */
  coupon: { code: string; discountCents: number } | null;
  /** Why the current quote refused `appliedCode`, if it did. */
  rejection: string | null;
  /** A quote with the new code is in flight. */
  checking: boolean;
  money: string;
  onApply: (code: string) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(appliedCode ?? "");
  const [emptyError, setEmptyError] = useState(false);

  function apply() {
    const code = draft.trim().toUpperCase();
    if (!code) {
      setEmptyError(true);
      return;
    }
    setEmptyError(false);
    setDraft(code);
    onApply(code);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      apply();
    }
  }

  /* Only trust the quote once it has caught up with the code on screen. */
  const accepted = !checking && coupon !== null && coupon.code === appliedCode;
  const refused = !checking && appliedCode !== null && rejection !== null;

  const error = emptyError
    ? t("checkout.coupon.empty")
    : refused
      ? t(
          isKnownReason(rejection)
            ? `checkout.coupon.rejected.${rejection}`
            : "checkout.coupon.rejected.generic",
        )
      : undefined;

  return (
    <section aria-label={t("checkout.coupon.legend")}>
      <Eyebrow as="h2">{t("checkout.coupon.legend")}</Eyebrow>

      {accepted ? (
        <div className="rounded-control border-rule bg-tint mt-4 flex flex-wrap items-center justify-between gap-3 border px-4 py-3">
          <p className="text-13.5 text-ink" role="status">
            {t("checkout.coupon.applied", {
              code: coupon.code,
              amount: formatMoney(coupon.discountCents, money),
            })}
          </p>
          <button
            type="button"
            onClick={() => {
              setDraft("");
              onRemove();
            }}
            className="text-caption text-secondary hover:text-ink underline underline-offset-2"
          >
            {t("checkout.coupon.remove")}
          </button>
        </div>
      ) : (
        <div className="mt-4 flex items-start gap-2">
          <Input
            fieldClassName="flex-1"
            aria-label={t("checkout.coupon.label")}
            placeholder={t("checkout.coupon.placeholder")}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value.toUpperCase());
              setEmptyError(false);
            }}
            onKeyDown={onKeyDown}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={64}
            error={error}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={apply}
            loading={checking}
            loadingLabel={t("checkout.coupon.applying")}
          >
            {t("checkout.coupon.apply")}
          </Button>
        </div>
      )}
    </section>
  );
}
