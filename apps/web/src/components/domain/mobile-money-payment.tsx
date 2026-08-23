"use client";

import { useQuery } from "@tanstack/react-query";
import type { FieldErrors, UseFormRegister, UseFormSetValue } from "react-hook-form";
import { useTranslation } from "react-i18next";

import type { PaymentNumbers, PaymentProvider } from "@sakura/contracts";
import { PaymentOption, PaymentOptionList } from "@/components/domain";
import { CopyButton, Input } from "@/components/ui";
import { getPaymentNumbers } from "@/lib/api/payments";
import type { CheckoutValues } from "@/lib/checkout";
import { paymentOption } from "@/lib/variants";
import { cn } from "@/lib/utils";

/* --------------------------------------------------------------------------
   MobileMoneyPayment — bKash / Rocket / Nagad, wireframe-free but the same
   PaymentOption vocabulary the rest of checkout uses.

   There is no gateway behind any of these three: the customer sends money
   out of band in their own banking app, so the control's job is to walk
   them through that hand-off —
     1. pick a provider,
     2. get the number to send to (one-tap copy; read-only — this is the
        number verification runs against, so it must not be editable in the
        browser), and
     3. fill in the fields that prove the transfer happened.
   The number and the proof-of-transfer fields show together as soon as a
   provider is picked — this control has no submit button of its own. It is
   one step inside the checkout page's payment step, which ends in the page's
   single "Place order" submit, so a second submit here would just be a
   second button doing the same job.

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
 * environment's, if nobody has) before a provider can be picked.
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

  const { data: numbers } = useQuery({
    queryKey: ["payment-numbers"],
    queryFn: getPaymentNumbers,
    staleTime: 5 * 60 * 1000,
  });
  const mobileMoneyProviders = providersFrom(numbers ?? placeholderNumbers);

  function selectProvider(id: MobileMoneyProviderId) {
    setValue("provider", id, { shouldValidate: true, shouldDirty: true });
    onProviderChange(id);
  }

  function clearProvider() {
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
            onSelect={() => selectProvider(entry.id)}
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
  onSelect,
  register,
  errors,
}: {
  entry: { id: PaymentProvider; number: string };
  checked: boolean;
  onSelect: () => void;
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
          <TransferDetails
            number={entry.number}
            providerLabel={label}
            register={register}
            errors={errors}
          />
        ) : undefined
      }
    />
  );
}

function TransferDetails({
  number,
  providerLabel,
  register,
  errors,
}: {
  number: string;
  providerLabel: string;
  register: UseFormRegister<CheckoutValues>;
  errors: FieldErrors<CheckoutValues>;
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

      <p className="text-caption text-secondary mt-3">
        {t("checkout.payment.sendToHint", { provider: providerLabel })}
      </p>

      <p className="text-caption text-secondary mt-3.5">{t("checkout.payment.verifyHint")}</p>

      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
        className="mt-3"
        label={t("checkout.payment.reference")}
        error={errors.notes?.message}
        {...register("notes")}
      />
    </div>
  );
}
