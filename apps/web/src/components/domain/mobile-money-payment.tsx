"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { FieldErrors, UseFormRegister, UseFormSetValue } from "react-hook-form";
import { useTranslation } from "react-i18next";

import type { PaymentNumbers, PaymentProvider } from "@sakura/contracts";
import { PaymentOption, PaymentOptionList } from "@/components/domain";
import { Button, CopyButton, Input } from "@/components/ui";
import { getPaymentNumbers } from "@/lib/api/payments";
import type { CheckoutValues } from "@/lib/checkout";
import { paymentOption } from "@/lib/variants";
import { cn } from "@/lib/utils";

/* --------------------------------------------------------------------------
   MobileMoneyPayment — bKash / Rocket / Nagad, wireframe-free but the same
   PaymentOption vocabulary the rest of checkout uses.

   There is no gateway behind any of these three: the customer sends money
   out of band in their own banking app, so the control's job is to walk
   them through that hand-off in order —
     1. pick a provider,
     2. get the number to send to (one-tap copy; read-only — this is the
        number verification runs against, so it must not be editable in the
        browser),
     3. say "I've sent it" to reveal the fields that prove it, and
     4. submit.
   Each provider gets its own local `phase`, keyed off which one is selected,
   so switching providers mid-flow always restarts at step 2 rather than
   showing stale verification fields for a different number.

   Once a provider is picked the other two unmount: past step 1 they are only
   noise, and a stray click on one would throw away whatever has been typed
   into the verification fields. Getting back to the full list is an explicit
   "change payment method" button rather than an accident — which is also what
   stands in for the radio-group semantics the collapsed list gives up.

   Reused as-is by both PreOrderPaymentSection and PaymentSection: the fields
   it fills — senderNumber, transactionId, notes — are the same three the
   `manual-transfer` branch of checkoutSchema already validates, so no
   contract change was needed to add three providers where there used to be
   one generic "bKash or bank transfer" option.
   -------------------------------------------------------------------------- */

/**
 * Placeholders shown for the instant before `getPaymentNumbers` resolves —
 * always non-empty, so the copy affordance always has something to work
 * with. Never what a customer actually sends money to: `useQuery` below
 * replaces these with the numbers Payment Settings has saved (or the
 * environment's, if nobody has) before the "complete transaction" button is
 * reachable.
 */
const placeholderNumbers: PaymentNumbers = {
  bkashNumber: "01712-345678",
  rocketNumber: "01812-345678",
  nagadNumber: "01912-345678",
};

/**
 * `id` is `PaymentProvider` from @sakura/contracts, not a locally invented
 * union: it is the same value that travels to the API as `customer.provider`
 * and lands in `orders.provider`, and the SMS gateway files receipts under
 * exactly these three collection names.
 */
function providersFrom(
  numbers: PaymentNumbers,
): readonly { id: PaymentProvider; number: string }[] {
  return [
    { id: "bkash", number: numbers.bkashNumber },
    { id: "rocket", number: numbers.rocketNumber },
    { id: "nagad", number: numbers.nagadNumber },
  ];
}

export type MobileMoneyProviderId = PaymentProvider;

type Phase = "pay" | "verify";

export function MobileMoneyPayment({
  register,
  setValue,
  errors,
  provider,
  onProviderChange,
  className,
}: {
  register: UseFormRegister<CheckoutValues>;
  /** Writes the chosen wallet onto the form as `provider`, the field
      `checkoutSchema` requires whenever `method` is `manual-transfer` — see
      the module comment on why this travels as an explicit field rather than
      being inferred from the transaction ID. */
  setValue: UseFormSetValue<CheckoutValues>;
  errors: FieldErrors<CheckoutValues>;
  provider: MobileMoneyProviderId | null;
  onProviderChange: (provider: MobileMoneyProviderId | null) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>("pay");

  const { data: numbers } = useQuery({
    queryKey: ["payment-numbers"],
    queryFn: getPaymentNumbers,
    staleTime: 5 * 60 * 1000,
  });
  const mobileMoneyProviders = providersFrom(numbers ?? placeholderNumbers);

  function selectProvider(id: MobileMoneyProviderId) {
    if (id !== provider) setPhase("pay");
    setValue("provider", id, { shouldValidate: true, shouldDirty: true });
    onProviderChange(id);
  }

  function clearProvider() {
    setPhase("pay");
    setValue("provider", undefined, { shouldValidate: true, shouldDirty: true });
    onProviderChange(null);
  }

  const shown = provider
    ? mobileMoneyProviders.filter((entry) => entry.id === provider)
    : mobileMoneyProviders;

  return (
    <div className={cn("min-w-0", className)}>
      <PaymentOptionList label={t("checkout.payment.mobileMoneyLegend")} className="gap-2.5">
        {shown.map((entry) => (
          <ProviderOption
            key={entry.id}
            entry={entry}
            checked={provider === entry.id}
            phase={phase}
            onSelect={() => selectProvider(entry.id)}
            onSent={() => setPhase("verify")}
            onBack={() => setPhase("pay")}
            register={register}
            errors={errors}
          />
        ))}
      </PaymentOptionList>

      {provider ? (
        <button
          type="button"
          onClick={clearProvider}
          className="text-caption text-secondary hover:text-ink mt-2.5 underline underline-offset-2"
        >
          {t("checkout.payment.changeMethod")}
        </button>
      ) : null}
    </div>
  );
}

function ProviderOption({
  entry,
  checked,
  phase,
  onSelect,
  onSent,
  onBack,
  register,
  errors,
}: {
  entry: { id: PaymentProvider; number: string };
  checked: boolean;
  phase: Phase;
  onSelect: () => void;
  onSent: () => void;
  onBack: () => void;
  register: UseFormRegister<CheckoutValues>;
  errors: FieldErrors<CheckoutValues>;
}) {
  const { t } = useTranslation();
  const label = t(`checkout.payment.${entry.id}`);

  return (
    <PaymentOption
      name="mobileMoneyProvider"
      value={entry.id}
      checked={checked}
      onSelect={onSelect}
      label={label}
      meta={t("checkout.payment.mobileMoneyMeta")}
      fields={
        checked ? (
          phase === "pay" ? (
            <SendMoneyStep number={entry.number} providerLabel={label} onSent={onSent} />
          ) : (
            <VerifyStep register={register} errors={errors} onBack={onBack} />
          )
        ) : undefined
      }
    />
  );
}

function SendMoneyStep({
  number,
  providerLabel,
  onSent,
}: {
  number: string;
  providerLabel: string;
  onSent: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className={cn(paymentOption({ selected: false }), "bg-tint border-none px-4 py-3.5")}>
      <p className="text-caption text-secondary">
        {t("checkout.payment.sendTo", { provider: providerLabel })}
      </p>

      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-body text-ink font-mono font-semibold tracking-wide">{number}</span>

        <div className="flex shrink-0 items-center gap-3">
          <CopyButton value={number} />
        </div>
      </div>

      <p className="text-caption text-secondary mt-3">{t("checkout.payment.sendToHint")}</p>

      <Button type="button" size="sm" className="mt-3.5" onClick={onSent}>
        {t("checkout.payment.completeTransaction")}
      </Button>
    </div>
  );
}

function VerifyStep({
  register,
  errors,
  onBack,
}: {
  register: UseFormRegister<CheckoutValues>;
  errors: FieldErrors<CheckoutValues>;
  onBack: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3.5">
      <p className="text-caption text-secondary">{t("checkout.payment.verifyHint")}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          label={t("checkout.payment.senderNumber")}
          inputMode="tel"
          error={errors.senderNumber?.message}
          {...register("senderNumber")}
        />
        <Input
          label={t("checkout.payment.transactionId")}
          error={errors.transactionId?.message}
          {...register("transactionId")}
        />
      </div>

      <Input
        label={t("checkout.payment.reference")}
        error={errors.notes?.message}
        {...register("notes")}
      />

      <div className="flex items-center gap-3">
        <Button type="submit" size="sm">
          {t("checkout.payment.completeOrder")}
        </Button>
        <button
          type="button"
          onClick={onBack}
          className="text-caption text-secondary hover:text-ink underline underline-offset-2"
        >
          {t("checkout.payment.back")}
        </button>
      </div>
    </div>
  );
}
