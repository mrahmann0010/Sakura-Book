"use client";

import { useState, type ReactNode } from "react";
import type { FieldErrors, UseFormRegister, UseFormSetValue } from "react-hook-form";
import { useTranslation } from "react-i18next";

import {
  MobileMoneyPayment,
  PaymentOption,
  PaymentOptionList,
  type MobileMoneyProviderId,
} from "@/components/domain";
import { Eyebrow } from "@/components/ui";
import type { AcceptedPaymentMethod, CheckoutValues } from "@/lib/checkout";

/* --------------------------------------------------------------------------
   The payment half of the checkout form (wireframe 1d/1e).

   Cash on delivery has been removed from this form — bKash/Rocket/Nagad is
   the only way to pay. The mobile-money hand-off is its own multi-step
   control (`MobileMoneyPayment`) rather than a single radio row, because
   "send money, then prove you sent it" doesn't fit one card. Card stays
   visible but disabled, stated in words rather than hidden (principle 03).
   -------------------------------------------------------------------------- */

export function PaymentSection({
  register,
  setValue,
  errors,
  method,
  onMethodChange,
  amount,
  breakdown,
}: {
  register: UseFormRegister<CheckoutValues>;
  setValue: UseFormSetValue<CheckoutValues>;
  errors: FieldErrors<CheckoutValues>;
  method: AcceptedPaymentMethod;
  onMethodChange: (method: AcceptedPaymentMethod) => void;
  /** The order total and its rows, handed to the transfer card — the shopper
      is about to type this figure into a banking app. */
  amount?: ReactNode;
  breakdown?: ReactNode;
}) {
  const { t } = useTranslation();
  const [provider, setProvider] = useState<MobileMoneyProviderId | null>(null);
  const chosen = provider !== null;

  return (
    <fieldset className="min-w-0">
      <Eyebrow as="legend">{t("checkout.payment.legend")}</Eyebrow>

      <MobileMoneyPayment
        className="mt-3.5"
        register={register}
        setValue={setValue}
        errors={errors}
        provider={provider}
        amount={amount}
        breakdown={breakdown}
        onProviderChange={(next) => {
          setProvider(next);
          if (next && method !== "manual-transfer") onMethodChange("manual-transfer");
        }}
      />

      {/* Same as the pre-order step: worth stating while the shopper is still
          deciding, pure noise once they have settled on a method. */}
      {chosen ? null : (
        <PaymentOptionList className="mt-2.5" label={t("checkout.payment.legend")}>
          <PaymentOption
            name="method"
            value="card"
            checked={false}
            disabled
            label={t("checkout.payment.card")}
            meta={t("checkout.payment.cardMeta")}
            description={t("checkout.payment.cardUnavailable")}
          />
        </PaymentOptionList>
      )}
    </fieldset>
  );
}
