"use client";

import type { FieldErrors, UseFormRegister } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { PaymentOption, PaymentOptionList } from "@/components/domain";
import { Eyebrow, Input } from "@/components/ui";
import {
  methodNeedsTransferDetails,
  type AcceptedPaymentMethod,
  type CheckoutValues,
  type PaymentMethod,
} from "@/lib/checkout";

/* --------------------------------------------------------------------------
   The pre-order's payment step — same building blocks as the real checkout's
   PaymentSection, over a smaller list.

   Pre-orders are prepaid only: there is no physical stock yet for a courier
   to collect cash against, so `cash-on-delivery` is left commented out below
   rather than deleted, the same way `card` stays visible-but-disabled instead
   of removed. Re-enabling it, if that ever makes sense, is uncommenting one
   line here and in preOrderPaymentMethods (@sakura/contracts), which is what
   the API actually enforces.
   -------------------------------------------------------------------------- */

const preOrderPaymentMethods: readonly PaymentMethod[] = [
  // "cash-on-delivery",
  "manual-transfer",
  "card",
];

const availablePreOrderPaymentMethods: readonly PaymentMethod[] = ["manual-transfer"];

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

  return (
    <fieldset className="min-w-0">
      <Eyebrow as="legend">{t("checkout.payment.legend")}</Eyebrow>

      <PaymentOptionList className="mt-3.5" label={t("checkout.payment.legend")}>
        {preOrderPaymentMethods.map((value) => {
          const disabled = !availablePreOrderPaymentMethods.includes(value);

          return (
            <PaymentOption
              key={value}
              name="method"
              value={value}
              checked={method === value}
              disabled={disabled}
              /* Safe: a disabled option cannot fire onSelect, so `next` is
                 always the one method this list makes selectable. */
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
