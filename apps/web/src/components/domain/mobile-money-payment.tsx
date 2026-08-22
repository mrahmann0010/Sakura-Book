"use client";

import { useState, useSyncExternalStore } from "react";
import type { FieldErrors, UseFormRegister, UseFormSetValue } from "react-hook-form";
import { useTranslation } from "react-i18next";

import type { PaymentProvider } from "@sakura/contracts";
import { PaymentOption, PaymentOptionList } from "@/components/domain";
import { Button, CopyButton, Input } from "@/components/ui";
import type { CheckoutValues } from "@/lib/checkout";
import { input, paymentOption } from "@/lib/variants";
import { cn } from "@/lib/utils";

/* --------------------------------------------------------------------------
   MobileMoneyPayment — bKash / Rocket / Nagad, wireframe-free but the same
   PaymentOption vocabulary the rest of checkout uses.

   There is no gateway behind any of these three: the customer sends money
   out of band in their own banking app, so the control's job is to walk
   them through that hand-off in order —
     1. pick a provider,
     2. get the number to send to (with one-tap copy — editable, since there
        is no admin panel yet for these numbers),
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
 * Placeholders until real numbers land in env — always non-empty, so the
 * copy/edit affordances always have something to work with.
 *
 * `id` is `PaymentProvider` from @sakura/contracts, not a locally invented
 * union: it is the same value that travels to the API as `customer.provider`
 * and lands in `orders.provider`, and the SMS gateway files receipts under
 * exactly these three collection names.
 */
export const mobileMoneyProviders: readonly { id: PaymentProvider; number: string }[] = [
  { id: "bkash", number: process.env.NEXT_PUBLIC_BKASH_NUMBER || "01712-345678" },
  { id: "rocket", number: process.env.NEXT_PUBLIC_ROCKET_NUMBER || "01812-345678" },
  { id: "nagad", number: process.env.NEXT_PUBLIC_NAGAD_NUMBER || "01912-345678" },
];

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

/**
 * One provider's card. Its own component (rather than inline in the `.map`
 * above) because it owns a hook — `useStoredNumber` — and hooks can't live
 * inside a loop body, only at a component's top level.
 */
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
  entry: (typeof mobileMoneyProviders)[number];
  checked: boolean;
  phase: Phase;
  onSelect: () => void;
  onSent: () => void;
  onBack: () => void;
  register: UseFormRegister<CheckoutValues>;
  errors: FieldErrors<CheckoutValues>;
}) {
  const { t } = useTranslation();
  const [number, setNumber] = useStoredNumber(entry.id, entry.number);
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
            <SendMoneyStep
              number={number}
              onNumberChange={setNumber}
              providerLabel={label}
              onSent={onSent}
            />
          ) : (
            <VerifyStep register={register} errors={errors} onBack={onBack} />
          )
        ) : undefined
      }
    />
  );
}

/**
 * Persists an editable override for a provider's receiving number in
 * localStorage, keyed by provider id. A stopgap for not having an admin
 * panel yet: whoever runs the shop can correct a wrong number from the
 * checkout page itself, and it sticks in that browser from then on.
 *
 * `useSyncExternalStore` rather than state-plus-effect: localStorage is an
 * external store, and reading it is exactly what the hook exists for — the
 * server snapshot (`fallback`) and the client snapshot (`fallback`, then the
 * stored override once mounted) never disagree at hydration time, since the
 * client snapshot function only touches `window` after mount.
 */
const storedNumberListeners = new Set<() => void>();

function subscribeToStoredNumbers(callback: () => void) {
  storedNumberListeners.add(callback);
  return () => storedNumberListeners.delete(callback);
}

function useStoredNumber(id: string, fallback: string) {
  const key = `sakura:payment-number:${id}`;
  const value = useSyncExternalStore(
    subscribeToStoredNumbers,
    () => window.localStorage.getItem(key) ?? fallback,
    () => fallback,
  );

  function update(next: string) {
    window.localStorage.setItem(key, next);
    storedNumberListeners.forEach((notify) => notify());
  }

  return [value, update] as const;
}

function SendMoneyStep({
  number,
  onNumberChange,
  providerLabel,
  onSent,
}: {
  number: string;
  onNumberChange: (next: string) => void;
  providerLabel: string;
  onSent: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(number);

  function startEditing() {
    setDraft(number);
    setEditing(true);
  }

  function save() {
    const trimmed = draft.trim();
    if (trimmed) onNumberChange(trimmed);
    setEditing(false);
  }

  return (
    <div className={cn(paymentOption({ selected: false }), "bg-tint border-none px-4 py-3.5")}>
      <p className="text-caption text-secondary">
        {t("checkout.payment.sendTo", { provider: providerLabel })}
      </p>

      <div className="mt-2 flex items-center justify-between gap-3">
        {editing ? (
          <input
            autoFocus
            inputMode="tel"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                save();
              }
              if (event.key === "Escape") setEditing(false);
            }}
            className={cn(input({ state: "filled" }), "font-mono text-13.5")}
          />
        ) : (
          <span className="text-body text-ink font-mono font-semibold tracking-wide">
            {number}
          </span>
        )}

        <div className="flex shrink-0 items-center gap-3">
          {editing ? (
            <button
              type="button"
              onClick={save}
              className="text-caption text-clay hover:text-clay-deep font-semibold"
            >
              {t("checkout.payment.save")}
            </button>
          ) : (
            <>
              <CopyButton value={number} />
              <button
                type="button"
                onClick={startEditing}
                aria-label={t("checkout.payment.editNumber")}
                title={t("checkout.payment.editNumber")}
                className="text-secondary hover:text-ink inline-flex"
              >
                <PencilIcon />
              </button>
            </>
          )}
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

function PencilIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M13.5 3.5l3 3L6 17H3v-3L13.5 3.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
