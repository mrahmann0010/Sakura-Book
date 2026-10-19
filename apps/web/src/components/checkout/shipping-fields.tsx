"use client";

import { TIER_REGION_SLUG, zoneById } from "@sakura/contracts";
import { useState } from "react";
import type { FieldErrors, UseFormRegister, UseFormSetValue } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Eyebrow, Input, Textarea } from "@/components/ui";
import { divisionOfDistrict } from "@/lib/bd-geo";
import type { CheckoutValues } from "@/lib/checkout";

import { ZonePicker } from "./zone-picker";

/* --------------------------------------------------------------------------
   The shipping half of the checkout form.

   Split from the view so the form's markup can be read on its own, and so the
   same fieldset can be reused by an address-book editor later. It takes
   `register` and `errors` rather than owning a form: there is one form on the
   page, one submit, and one source of truth for validity.

   The address block is built around the delivery zone — one searchable pick
   from the shared zone list (@sakura/contracts' shipping-zones), which is
   what postage is priced off and what the Pathao manifest is filled from.
   Inside Dhaka and the suburbs the zone is the thana, so there is nothing
   more to ask; outside Dhaka the zone is a whole district, so the upazila is
   asked for as free text below it. Everything is then composed into the
   single `address` line a customer and a rider read, with the parts kept
   alongside it unjoined for the manifest.
   -------------------------------------------------------------------------- */

export function ShippingFields({
  register,
  errors,
  setValue,
}: {
  register: UseFormRegister<CheckoutValues>;
  errors: FieldErrors<CheckoutValues>;
  setValue: UseFormSetValue<CheckoutValues>;
}) {
  const { t } = useTranslation();

  const [zoneId, setZoneId] = useState("");
  const [upazila, setUpazila] = useState("");
  const [area, setArea] = useState("");
  const [detail, setDetail] = useState("");
  const [postCode, setPostCode] = useState("");

  const zone = zoneById(zoneId);
  /* A district-level pick names the city but not the thana — the case where
     the upazila still has to be typed. */
  const needsUpazila = zone ? zone.name === zone.city : false;

  function sync(next: {
    zoneId?: string;
    upazila?: string;
    area?: string;
    detail?: string;
    postCode?: string;
  }) {
    const chosen = zoneById(next.zoneId ?? zoneId);
    const districtLevel = chosen ? chosen.name === chosen.city : false;
    const merged = {
      upazila: districtLevel ? (next.upazila ?? upazila) : "",
      area: next.area ?? area,
      detail: next.detail ?? detail,
      postCode: next.postCode ?? postCode,
    };
    const city = chosen?.city ?? "";
    const divisionLabel = chosen ? (divisionOfDistrict(city)?.label ?? "") : "";
    /* Inside Dhaka the zone is the thana, so it takes the upazila's place in
       the line; outside, the typed upazila does. English names on purpose —
       this line is read by the rider, and the manifest is romanised anyway. */
    const locality = districtLevel ? merged.upazila : (chosen?.name ?? "");

    setValue("zone", chosen?.id ?? "", { shouldValidate: true, shouldDirty: true });
    /* Ignored by the API, which derives the tier from `zone` — sent so this
       form still places orders against an API deployed before zones were,
       which requires it. Deploy order: web first, then the API. */
    setValue("region", chosen ? TIER_REGION_SLUG[chosen.tier] : "", { shouldDirty: true });
    setValue("city", city, { shouldValidate: true, shouldDirty: true });

    /* The parts, kept beside the line they are joined into below — sent rather
       than recovered by splitting `address` back up, which cannot be made to
       work. */
    setValue("upazila", merged.upazila, { shouldDirty: true });
    setValue("area", merged.area, { shouldDirty: true });
    setValue("postCode", merged.postCode, { shouldDirty: true });
    setValue(
      "address",
      [
        merged.detail,
        [merged.area, locality].filter(Boolean).join(", "),
        [city, divisionLabel].filter((part, i, all) => part && all.indexOf(part) === i).join(", "),
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
      <p className="text-body text-ink mt-1.5">{t("checkout.shipping.legendHint")}</p>

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
        />
        {/* The courier's fallback number. Optional, and labelled as such —
            the manifest has a slot for it, most orders will leave it empty. */}
        <Input
          label={t("checkout.shipping.secondaryPhone")}
          hint={t("checkout.shipping.secondaryPhoneHint")}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          error={errors.secondaryPhone?.message}
          {...register("secondaryPhone")}
        />

        <ZonePicker
          label={t("checkout.shipping.zone")}
          placeholder={t("checkout.shipping.zonePlaceholder")}
          value={zoneId}
          error={errors.zone?.message}
          hint={
            zone ? t(`checkout.shipping.tier.${zone.tier}`) : t("checkout.shipping.zonePending")
          }
          onChange={(next) => {
            setZoneId(next.id);
            sync({ zoneId: next.id });
          }}
        />

        {needsUpazila ? (
          <Input
            label={t("checkout.shipping.upazila")}
            value={upazila}
            onChange={(e) => {
              setUpazila(e.target.value);
              sync({ upazila: e.target.value });
            }}
          />
        ) : null}
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
