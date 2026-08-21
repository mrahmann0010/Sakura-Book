"use client";

import { useState } from "react";
import type { FieldErrors, UseFormRegister } from "react-hook-form";
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
   The pre-order's payment step — same building blocks as the real checkout's
   PaymentSection.

   Pre-orders are prepaid only: there is no physical stock yet for a courier
   to collect cash against, so `cash-on-delivery` has no place here at all.
   The only live path is `MobileMoneyPayment` — bKash/Rocket/Nagad, walking
   the shopper through send-money-then-verify — which fills the same
   `senderNumber`/`transactionId` pair the API's `manual-transfer` method has
   always accepted. `card` stays visible-but-disabled rather than removed,
   same as the real checkout's card option.
   -------------------------------------------------------------------------- */

export function PreOrderPaymentSection({
  register,
  errors,
  method,
  onMethodChange,
}: {
  register: UseFormRegister<CheckoutValues>;
  errors: FieldErrors<CheckoutValues>;
  method: AcceptedPaymentMethod;
  onMethodChange: (method: AcceptedPaymentMethod) => void;
}) {
  const { t } = useTranslation();
  const [provider, setProvider] = useState<MobileMoneyProviderId | null>(null);

  return (
    <fieldset className="min-w-0">
      <Eyebrow as="legend">{t("checkout.payment.legend")}</Eyebrow>

      <MobileMoneyPayment
        className="mt-3.5"
        register={register}
        errors={errors}
        provider={provider}
        onProviderChange={(next) => {
          setProvider(next);
          if (method !== "manual-transfer") onMethodChange("manual-transfer");
        }}
      />

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
    </fieldset>
  );
}
