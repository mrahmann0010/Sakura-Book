"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { FieldErrors, UseFormRegister, UseFormSetValue } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Eyebrow, Field, Input, Select, Textarea } from "@/components/ui";
import { getShippingTerms } from "@/lib/api/shipping";
import { bdDivisions, deliveryZoneFor, districtsFor } from "@/lib/bd-geo";
import type { CheckoutValues } from "@/lib/checkout";

/* --------------------------------------------------------------------------
   The shipping half of the checkout form.

   Split from the view so the form's markup can be read on its own, and so the
   same fieldset can be reused by an address-book editor later. It takes
   `register` and `errors` rather than owning a form: there is one form on the
   page, one submit, and one source of truth for validity.

   The Bangladesh address block (Division → District → Upazila/Thana →
   Area/Village → detailed address → post code) is client-side structure over
   the existing `address` and `city` schema fields, not new schema fields:
   division/district drive a cascading picker, and everything below it is
   composed into `address`/`city` on change. That keeps the shared
   checkoutSchema — validated identically by the API — untouched while the
   customer still fills in a properly BD-shaped address. Upazila/Area stay
   free text: there is no wired-in authoritative upazila list to drive a third
   dropdown from.
   -------------------------------------------------------------------------- */

export function ShippingFields({
  register,
  errors,
  setValue,
  onDivisionChange,
}: {
  register: UseFormRegister<CheckoutValues>;
  errors: FieldErrors<CheckoutValues>;
  setValue: UseFormSetValue<CheckoutValues>;
  /**
   * Fires with the chosen division, "" until one is.
   *
   * The recap needs to know whether a division has actually been picked, and
   * `region` cannot tell it: that field is seeded to "inside-dhaka" by
   * `checkoutDefaults`, so it is truthy before the shopper has chosen
   * anything. This local state is the only honest signal, so it is reported
   * up rather than re-derived.
   */
  onDivisionChange?: (division: string) => void;
}) {
  const { t } = useTranslation();

  /* Where the shop is shipping from right now — an admin setting, not a
     constant, so the zone below tracks it instead of assuming Dhaka.
     Defaults to "dhaka" while the request is in flight: the same value
     WAREHOUSE_DIVISION itself defaults to, so an unloaded query and an
     unconfigured shop compute the same (correct, for today) zone rather than
     the form flashing a wrong one. */
  const { data: terms } = useQuery({
    queryKey: ["shipping-terms"],
    queryFn: getShippingTerms,
    staleTime: 5 * 60 * 1000,
  });
  const originDivision = terms?.originDivision ?? "dhaka";

  const [division, setDivision] = useState("");
  const [district, setDistrict] = useState("");
  const [upazila, setUpazila] = useState("");
  const [area, setArea] = useState("");
  const [detail, setDetail] = useState("");
  const [postCode, setPostCode] = useState("");

  const districts = districtsFor(division);

  function sync(next: {
    division?: string;
    district?: string;
    upazila?: string;
    area?: string;
    detail?: string;
    postCode?: string;
  }) {
    const divisionLabel =
      bdDivisions.find((d) => d.value === (next.division ?? division))?.label ?? "";
    const merged = {
      district: next.district ?? district,
      upazila: next.upazila ?? upazila,
      area: next.area ?? area,
      detail: next.detail ?? detail,
      postCode: next.postCode ?? postCode,
    };

    const zoneDivision = next.division ?? division;

    setValue("city", merged.district, { shouldValidate: true, shouldDirty: true });
    setValue("region", deliveryZoneFor(zoneDivision, originDivision), {
      shouldValidate: true,
      shouldDirty: true,
    });
    setValue(
      "address",
      [
        merged.detail,
        [merged.area, merged.upazila].filter(Boolean).join(", "),
        [merged.district, divisionLabel].filter(Boolean).join(", "),
        merged.postCode,
      ]
        .filter(Boolean)
        .join("\n"),
      { shouldValidate: true, shouldDirty: true },
    );
  }

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

        <Select
          label={t("checkout.shipping.division")}
          options={[
            { value: "", label: t("checkout.shipping.divisionPlaceholder"), disabled: true },
            ...bdDivisions.map((d) => ({ value: d.value, label: d.label })),
          ]}
          value={division}
          onChange={(e) => {
            const value = e.target.value;
            setDivision(value);
            setDistrict("");
            sync({ division: value, district: "" });
            onDivisionChange?.(value);
          }}
        />
        <Select
          label={t("checkout.shipping.district")}
          disabled={!division}
          error={errors.city?.message}
          options={[
            { value: "", label: t("checkout.shipping.districtPlaceholder"), disabled: true },
            ...districts.map((name) => ({ value: name, label: name })),
          ]}
          value={district}
          onChange={(e) => {
            const value = e.target.value;
            setDistrict(value);
            sync({ district: value });
          }}
        />

        <Input
          label={t("checkout.shipping.upazila")}
          value={upazila}
          onChange={(e) => {
            setUpazila(e.target.value);
            sync({ upazila: e.target.value });
          }}
        />
        <Input
          label={t("checkout.shipping.area")}
          value={area}
          onChange={(e) => {
            setArea(e.target.value);
            sync({ area: e.target.value });
          }}
        />

        <Textarea
          label={t("checkout.shipping.address")}
          hint={t("checkout.shipping.addressHint")}
          autoComplete="street-address"
          rows={3}
          error={errors.address?.message}
          value={detail}
          onChange={(e) => {
            setDetail(e.target.value);
            sync({ detail: e.target.value });
          }}
          fieldClassName="sm:col-span-2"
        />

        <Input
          label={t("checkout.shipping.postCode")}
          inputMode="numeric"
          autoComplete="postal-code"
          value={postCode}
          onChange={(e) => {
            setPostCode(e.target.value);
            sync({ postCode: e.target.value });
          }}
        />
        <Field label={t("checkout.shipping.region")} error={errors.region?.message}>
          <p className="text-body">
            {division
              ? t(
                  deliveryZoneFor(division, originDivision) === "inside-dhaka"
                    ? "checkout.shipping.zoneInsideDhaka"
                    : "checkout.shipping.zoneOutsideDhaka",
                )
              : t("checkout.shipping.zonePending")}
          </p>
        </Field>

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
