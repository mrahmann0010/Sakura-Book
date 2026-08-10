"use client";

import type { FieldErrors, UseFormRegister } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Eyebrow, Input, Select, Textarea } from "@/components/ui";
import { regions, type CheckoutValues } from "@/lib/checkout";

/* --------------------------------------------------------------------------
   The shipping half of the checkout form.

   Split from the view so the form's markup can be read on its own, and so the
   same fieldset can be reused by an address-book editor later. It takes
   `register` and `errors` rather than owning a form: there is one form on the
   page, one submit, and one source of truth for validity.
   -------------------------------------------------------------------------- */

export function ShippingFields({
  register,
  errors,
}: {
  register: UseFormRegister<CheckoutValues>;
  errors: FieldErrors<CheckoutValues>;
}) {
  const { t } = useTranslation();

  return (
    <fieldset className="min-w-0">
      <Eyebrow as="legend">{t("checkout.shipping.legend")}</Eyebrow>

      <div className="mt-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <Input
          label={t("checkout.shipping.fullName")}
          autoComplete="name"
          error={errors.fullName?.message}
          {...register("fullName")}
        />
        <Input
          label={t("checkout.shipping.email")}
          type="email"
          inputMode="email"
          autoComplete="email"
          error={errors.email?.message}
          {...register("email")}
        />
        <Input
          label={t("checkout.shipping.phone")}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          error={errors.phone?.message}
          {...register("phone")}
          fieldClassName="sm:col-span-2"
        />
        <Textarea
          label={t("checkout.shipping.address")}
          hint={t("checkout.shipping.addressHint")}
          autoComplete="street-address"
          rows={3}
          error={errors.address?.message}
          {...register("address")}
          fieldClassName="sm:col-span-2"
        />
        <Input
          label={t("checkout.shipping.city")}
          autoComplete="address-level2"
          error={errors.city?.message}
          {...register("city")}
        />
        <Select
          label={t("checkout.shipping.region")}
          options={regions.map((region) => ({ value: region.value, label: region.label }))}
          error={errors.region?.message}
          {...register("region")}
        />
        <Textarea
          label={t("checkout.shipping.notes")}
          hint={t("checkout.shipping.notesHint")}
          rows={2}
          error={errors.notes?.message}
          {...register("notes")}
          fieldClassName="sm:col-span-2"
        />
      </div>
    </fieldset>
  );
}
