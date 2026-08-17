"use client";

import type { FieldErrors, UseFormRegister } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { PaymentOption, PaymentOptionList } from "@/components/domain";
import { Eyebrow, Input } from "@/components/ui";
import {
  availablePaymentMethods,
  methodNeedsTransferDetails,
  paymentMethods,
  type AcceptedPaymentMethod,
  type CheckoutValues,
} from "@/lib/checkout";

/* --------------------------------------------------------------------------
   The payment half of the checkout form (wireframe 1d/1e).

   Every method the shop will ever offer is listed, including the one that is
   not switched on yet: the wireframe draws card as "later", and principle 03
   says an unavailable state is stated in words rather than hidden. Which
   methods are selectable is data (`availablePaymentMethods`), so turning the
   gateway on is a one-line change in lib/checkout.ts, not an edit here.
   -------------------------------------------------------------------------- */

export function PaymentSection({
  register,
  errors,
  method,
  onMethodChange,
}: {
  register: UseFormRegister<CheckoutValues>;
  errors: FieldErrors<CheckoutValues>;
  /* AcceptedPaymentMethod, not PaymentMethod: the list below renders every
     method the shop will ever offer, but only an accepted one can ever be the
     form's value — the schema refuses `card`, on both sides of the wire. The
     disabled attribute is now the presentation of that rule rather than the
     only thing enforcing it. */
  method: AcceptedPaymentMethod;
  onMethodChange: (method: AcceptedPaymentMethod) => void;
}) {
  const { t } = useTranslation();

  return (
    <fieldset className="min-w-0">
      <Eyebrow as="legend">{t("checkout.payment.legend")}</Eyebrow>

      <PaymentOptionList className="mt-3.5" label={t("checkout.payment.legend")}>
        {paymentMethods.map((value) => {
          const disabled = !availablePaymentMethods.includes(value);

          return (
            <PaymentOption
              key={value}
              name="method"
              value={value}
              checked={method === value}
              disabled={disabled}
              /* Safe: a disabled option cannot fire onSelect, so `next` is
                 always one of availablePaymentMethods. */
              onSelect={(next) => onMethodChange(next as AcceptedPaymentMethod)}
              label={t(`checkout.payment.${value}`)}
              meta={t(`checkout.payment.${value}Meta`)}
              description={
                disabled
                  ? t("checkout.payment.cardUnavailable")
                  : methodNeedsTransferDetails(value)
                    ? t("checkout.payment.manual-transferHint")
                    : undefined
              }
              fields={
                methodNeedsTransferDetails(value) ? (
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
                ) : undefined
              }
            />
          );
        })}
      </PaymentOptionList>
    </fieldset>
  );
}
