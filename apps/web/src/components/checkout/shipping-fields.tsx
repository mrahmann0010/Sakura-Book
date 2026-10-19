"use client";

import { TIER_REGION_SLUG, zoneById, zonesInDistrict, type ShippingZone } from "@sakura/contracts";
import { useState } from "react";
import type { FieldErrors, UseFormRegister, UseFormSetValue } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Eyebrow, Input, Radio, RadioGroup, Select, Textarea } from "@/components/ui";
import { bdDivisions, districtsFor, divisionOfDistrict } from "@/lib/bd-geo";
import type { CheckoutValues } from "@/lib/checkout";

/* --------------------------------------------------------------------------
   The shipping half of the checkout form.

   Split from the view so the form's markup can be read on its own, and so the
   same fieldset can be reused by an address-book editor later. It takes
   `register` and `errors` rather than owning a form: there is one form on the
   page, one submit, and one source of truth for validity.

   The address block asks only what the delivery price depends on, in as few
   steps as that allows: Division → District, and that is the price for all
   but two districts. Dhaka district adds one choice of three — the city, the
   Savar/Keraniganj ring, or Dohar/Nawabganj — shown as radio buttons with
   examples so nobody has to hunt through a list; Munshiganj adds "Gazaria or
   elsewhere". A customer in Rajshahi never sees a Dhaka option.

   The thana or upazila is then typed, by everyone, as free text. It is what
   the courier reads, but no price pivots on it, so it is not a pick.

   Whichever step lands on it, the result is one zone from the shared list
   (@sakura/contracts' shipping-zones) — what postage is priced off. Everything
   is then composed into the single `address` line a customer and a rider
   read, with the parts kept alongside it unjoined for the Pathao manifest.
   -------------------------------------------------------------------------- */

/* Bangla names for the division and district dropdowns. Districts reuse the
   zone list's own Bangla where it has a whole-district entry; Dhaka, which is
   only ever split, is named here. */
const DIVISION_BN: Record<string, string> = {
  dhaka: "ঢাকা",
  chattogram: "চট্টগ্রাম",
  rajshahi: "রাজশাহী",
  khulna: "খুলনা",
  barishal: "বরিশাল",
  sylhet: "সিলেট",
  rangpur: "রংপুর",
  mymensingh: "ময়মনসিংহ",
};

/** A zone that is the whole district rather than a part of one. */
function wholeDistrict(zone: ShippingZone): boolean {
  return zone.name === zone.city;
}

function districtBn(district: string): string {
  if (district === "Dhaka") return "ঢাকা";

  return zonesInDistrict(district).find(wholeDistrict)?.nameBn ?? district;
}

export function ShippingFields({
  register,
  errors,
  setValue,
}: {
  register: UseFormRegister<CheckoutValues>;
  errors: FieldErrors<CheckoutValues>;
  setValue: UseFormSetValue<CheckoutValues>;
}) {
  const { t, i18n } = useTranslation();
  const bangla = i18n.language === "bn";

  const [division, setDivision] = useState("");
  const [district, setDistrict] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [upazila, setUpazila] = useState("");
  const [area, setArea] = useState("");
  const [detail, setDetail] = useState("");
  const [postCode, setPostCode] = useState("");

  const zone = zoneById(zoneId);
  const districtZones = district ? zonesInDistrict(district) : [];
  /* The extra choice exists only where the district holds more than one
     price: Dhaka (three) and Munshiganj (two). */
  const needsArea = districtZones.length > 1;
  const tierHint = zone ? t(`checkout.shipping.tier.${zone.tier}`) : undefined;
  const zoneName = (option: ShippingZone) => (bangla ? option.nameBn : option.name);

  function chooseDistrict(next: string) {
    const zones = next ? zonesInDistrict(next) : [];
    /* One zone means the district is the zone — chosen for the customer. */
    const nextZone = zones.length === 1 ? zones[0].id : "";

    setDistrict(next);
    setZoneId(nextZone);
    sync({ zoneId: nextZone });
  }

  function sync(next: {
    zoneId?: string;
    upazila?: string;
    area?: string;
    detail?: string;
    postCode?: string;
  }) {
    const chosen = zoneById(next.zoneId ?? zoneId);
    const merged = {
      upazila: next.upazila ?? upazila,
      area: next.area ?? area,
      detail: next.detail ?? detail,
      postCode: next.postCode ?? postCode,
    };
    const city = chosen?.city ?? "";
    const divisionLabel = chosen ? (divisionOfDistrict(city)?.label ?? "") : "";

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
        [merged.area, merged.upazila].filter(Boolean).join(", "),
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

        <Select
          label={t("checkout.shipping.division")}
          options={[
            { value: "", label: t("checkout.shipping.divisionPlaceholder"), disabled: true },
            ...bdDivisions.map((d) => ({
              value: d.value,
              label: bangla ? (DIVISION_BN[d.value] ?? d.label) : d.label,
            })),
          ]}
          value={division}
          onChange={(e) => {
            setDivision(e.target.value);
            chooseDistrict("");
          }}
        />
        <Select
          label={t("checkout.shipping.district")}
          disabled={!division}
          /* The zone error lands on whichever control finishes the choice. */
          error={needsArea ? undefined : errors.zone?.message}
          hint={needsArea ? undefined : tierHint}
          options={[
            { value: "", label: t("checkout.shipping.districtPlaceholder"), disabled: true },
            ...districtsFor(division).map((name) => ({
              value: name,
              label: bangla ? districtBn(name) : name,
            })),
          ]}
          value={district}
          onChange={(e) => chooseDistrict(e.target.value)}
        />

        {district === "Dhaka" ? (
          <div className="sm:col-span-2">
            <RadioGroup name="dhaka-zone" label={t("checkout.shipping.dhakaZone")}>
              {districtZones.map((option) => (
                <Radio
                  key={option.id}
                  name="dhaka-zone"
                  value={option.id}
                  checked={zoneId === option.id}
                  description={t(`checkout.shipping.dhakaZoneExamples.${option.id}`)}
                  onChange={() => {
                    setZoneId(option.id);
                    sync({ zoneId: option.id });
                  }}
                >
                  {zoneName(option)}
                </Radio>
              ))}
            </RadioGroup>
            <p
              className={
                errors.zone?.message
                  ? "text-13.5 text-clay mt-2"
                  : "text-caption text-secondary mt-2"
              }
            >
              {errors.zone?.message ?? tierHint ?? t("checkout.shipping.zonePending")}
            </p>
          </div>
        ) : needsArea ? (
          <Select
            label={t("checkout.shipping.zone")}
            error={errors.zone?.message}
            hint={tierHint}
            options={[
              { value: "", label: t("checkout.shipping.zoneSelect"), disabled: true },
              ...districtZones.map((option) => ({
                value: option.id,
                label: wholeDistrict(option)
                  ? t("checkout.shipping.zoneRestOfDistrict", { district: zoneName(option) })
                  : zoneName(option),
              })),
            ]}
            value={zoneId}
            onChange={(e) => {
              setZoneId(e.target.value);
              sync({ zoneId: e.target.value });
            }}
          />
        ) : null}

        {zone ? (
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
