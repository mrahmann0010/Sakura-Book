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
   The payment half of the checkout form (wireframe 1d/1e).

   Three shapes of option live side by side: a plain choice (cash on
   delivery), a disabled one stated in words rather than hidden (card,
   "later" — principle 03), and the bKash/Rocket/Nagad hand-off, which is
   its own multi-step control (`MobileMoneyPayment`, shared with the
   pre-order checkout) rather than a single radio row, because "send money,
   then prove you sent it" doesn't fit one card.
   -------------------------------------------------------------------------- */

export function PaymentSection({
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
  const chosen = provider !== null || method === "cash-on-delivery";

  return (
    <fieldset className="min-w-0">
      <Eyebrow as="legend">{t("checkout.payment.legend")}</Eyebrow>

      <PaymentOptionList className="mt-3.5" label={t("checkout.payment.legend")}>
        <PaymentOption
          name="method"
          value="cash-on-delivery"
          checked={method === "cash-on-delivery"}
          onSelect={(next) => {
            // Picking cash also drops the mobile-money selection: otherwise the
            // collapsed provider card would sit there looking active under a
            // method that is no longer chosen.
            setProvider(null);
            onMethodChange(next as AcceptedPaymentMethod);
          }}
          label={t("checkout.payment.cash-on-delivery")}
          meta={t("checkout.payment.cash-on-deliveryMeta")}
        />
      </PaymentOptionList>

      <MobileMoneyPayment
        className="mt-2.5"
        register={register}
        errors={errors}
        provider={provider}
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
