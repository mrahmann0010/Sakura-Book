"use client";

import { useState, type ReactNode } from "react";
import type { FieldErrors, UseFormRegister, UseFormSetValue } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { COD_CONFIRMATION_HOURS } from "@sakura/contracts";

import {
  MobileMoneyPayment,
  PaymentOption,
  PaymentOptionList,
  type MobileMoneyProviderId,
} from "@/components/domain";
import { Checkbox, Eyebrow } from "@/components/ui";
import type { AcceptedPaymentMethod, CheckoutValues } from "@/lib/checkout";

/* --------------------------------------------------------------------------
   The payment half of the checkout form (wireframe 1d/1e).

   Three shapes of option live side by side: cash on delivery, the
   bKash/Rocket/Nagad hand-off (its own multi-step control,
   `MobileMoneyPayment`, because "send money, then prove you sent it" doesn't
   fit one card), and card, drawn disabled and stated in words rather than
   hidden (principle 03).

   Cash on delivery was taken out of this form in August and is back with a
   condition: the shopper ticks that they have seen the total and will pay the
   courier, and is told up front that the order waits until they message the
   shop's Facebook page. See docs/cod-orders.md.
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
  const chosen = provider !== null || method === "cash-on-delivery";
  const ackError = errors.codAcknowledged?.message;

  return (
    <fieldset className="min-w-0">
      <Eyebrow as="legend">{t("checkout.payment.legend")}</Eyebrow>

      <PaymentOptionList className="mt-3.5" label={t("checkout.payment.legend")}>
        <PaymentOption
          name="method"
          value="cash-on-delivery"
          checked={method === "cash-on-delivery"}
          onSelect={() => {
            // Picking cash also drops the mobile-money selection: otherwise the
            // collapsed provider card would sit there looking active under a
            // method that is no longer chosen.
            setProvider(null);
            onMethodChange("cash-on-delivery");
          }}
          label={t("checkout.payment.cash-on-delivery")}
          meta={t("checkout.payment.cash-on-deliveryMeta")}
          fields={
            <div className="flex flex-col gap-3">
              {/* Said before the order is placed, not only after: a shopper who
                  will not message a Facebook page should find out now, while
                  bKash is one tap away, not from a thank-you screen. */}
              <p className="text-caption text-secondary">
                {t("checkout.payment.codHowItWorks", { hours: COD_CONFIRMATION_HOURS })}
              </p>
              <div>
                <Checkbox
                  {...register("codAcknowledged")}
                  aria-invalid={ackError ? true : undefined}
                  description={
                    amount ? (
                      <>
                        {t("checkout.payment.codTotal")}{" "}
                        <strong className="text-ink">{amount}</strong>
                      </>
                    ) : undefined
                  }
                >
                  {t("checkout.payment.codAcknowledge")}
                </Checkbox>
                {ackError ? (
                  <p role="alert" className="text-caption text-clay mt-1.5">
                    {ackError}
                  </p>
                ) : null}
              </div>
            </div>
          }
        />
      </PaymentOptionList>

      <MobileMoneyPayment
        className="mt-2.5"
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
