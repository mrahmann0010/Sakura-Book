"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  RATE_LADDER,
  shippingCentsFor,
  shippingTiers,
  TIER_REGION_SLUG,
  type AdminRegion,
  type AdminShippingTerms,
  type ShippingTier,
} from "@sakura/contracts";

import { AdminFormSkeleton } from "@/components/admin/skeletons";
import { Button, Input } from "@/components/ui";
import {
  AdminApiError,
  createAdminRegion,
  getAdminShippingTerms,
  listAdminRegions,
  updateAdminRegion,
  updateAdminShippingTerms,
} from "@/lib/api/admin";

type TermsForm = {
  flatRateTaka: string;
  freeDeliveryThresholdTaka: string;
};

function fromTerms(terms: AdminShippingTerms): TermsForm {
  return {
    flatRateTaka: String(terms.flatRateCents / 100),
    freeDeliveryThresholdTaka: String(terms.freeDeliveryThresholdCents / 100),
  };
}

function taka(cents: number | null): string {
  return cents === null ? "" : String(cents / 100);
}

const TIER_NAMES: Record<ShippingTier, string> = {
  ISD: "Inside Dhaka",
  SUBURB: "Dhaka Suburbs",
  OSD: "Outside Dhaka",
};

const TIER_SORT: Record<ShippingTier, number> = { ISD: 1, SUBURB: 2, OSD: 3 };

/** What each tier covers, as checkout offers it — see shipping-zones. */
const TIER_COVERS: Record<ShippingTier, string> = {
  ISD: "Dhaka city (City Corporation)",
  SUBURB: "Savar, Ashulia, Keraniganj, Dhamrai, Gazipur, Narayanganj, Gazaria",
  OSD: "Every other district, plus Dohar and Nawabganj",
};

function money(cents: number): string {
  return `৳${(cents / 100).toLocaleString("en-US")}`;
}

/** The ladder a start price produces — what the row will actually charge. */
function ladderLine(tier: ShippingTier, startCents: number | null): string {
  const extra = RATE_LADDER[tier].extraPerKgCents;

  return [
    `≤0.5 kg ${money(shippingCentsFor(tier, 500, startCents))}`,
    `≤1 kg ${money(shippingCentsFor(tier, 1000, startCents))}`,
    `≤2 kg ${money(shippingCentsFor(tier, 2000, startCents))}`,
    `then +${money(extra)}/kg`,
  ].join(" · ");
}

/**
 * What postage costs, and when it is waived.
 *
 * Postage is priced per Pathao tier — Inside Dhaka, Dhaka Suburbs, Outside
 * Dhaka — from the zone the customer picks at checkout and the parcel's
 * weight. Each tier's ≤0.5kg start price is its `delivery_regions` row and is
 * edited here; the weight steps above it are fixed in the shared rate ladder
 * (@sakura/contracts' shipping-rates) and move with the start price.
 *
 * A tier with no row yet still prices, at the ladder's published default —
 * "Set up" here creates the row so the price can be edited. Pickup is always
 * Dhaka city, which is what the tiers assume, so there is no "shipping from"
 * setting any more.
 *
 * The Shipping tab of Shop Settings — the sidebar entry, the gate, and the
 * page heading all live in `AdminSettingsShell`.
 */
export default function AdminShippingSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<Pick<
    AdminShippingTerms,
    "source" | "updatedAt" | "updatedByEmail"
  > | null>(null);
  const [form, setForm] = useState<TermsForm>({
    flatRateTaka: "",
    freeDeliveryThresholdTaka: "",
  });

  const [regions, setRegions] = useState<AdminRegion[]>([]);
  const [regionRates, setRegionRates] = useState<Record<string, string>>({});
  const [regionsError, setRegionsError] = useState<string | null>(null);
  const [savingSlug, setSavingSlug] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    Promise.all([getAdminShippingTerms(), listAdminRegions()])
      .then(([terms, regionList]) => {
        if (cancelled) return;
        setForm(fromTerms(terms));
        setMeta(terms);
        setRegions(regionList);
        setRegionRates(
          Object.fromEntries(
            regionList.map((region) => [region.slug, taka(region.deliveryCentsOverride)]),
          ),
        );
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof AdminApiError ? cause.message : "Could not load shipping settings.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const updated = await updateAdminShippingTerms({
        flatRateCents: Math.round(Number(form.flatRateTaka) * 100),
        freeDeliveryThresholdCents: Math.round(Number(form.freeDeliveryThresholdTaka) * 100),
      });
      setForm(fromTerms(updated));
      setMeta(updated);
    } catch (cause) {
      setError(
        cause instanceof AdminApiError ? cause.message : "Could not save shipping settings.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveTier(tier: ShippingTier) {
    const slug = TIER_REGION_SLUG[tier];
    setSavingSlug(slug);
    setRegionsError(null);

    try {
      const raw = regionRates[slug]?.trim() ?? "";
      const deliveryCentsOverride = raw === "" ? null : Math.round(Number(raw) * 100);
      const exists = regions.some((region) => region.slug === slug);

      /* A tier whose row was never seeded is created on its first save, so a
         live shop can be brought onto three tiers from here rather than by a
         deploy step. */
      const updated = exists
        ? await updateAdminRegion(slug, { deliveryCentsOverride })
        : await createAdminRegion({
            slug,
            name: TIER_NAMES[tier],
            deliveryCentsOverride: deliveryCentsOverride ?? RATE_LADDER[tier].startCents,
            sortOrder: TIER_SORT[tier],
          });

      setRegions((prev) =>
        exists
          ? prev.map((region) => (region.slug === slug ? updated : region))
          : [...prev, updated],
      );
      setRegionRates((prev) => ({ ...prev, [slug]: taka(updated.deliveryCentsOverride) }));
    } catch (cause) {
      setRegionsError(
        cause instanceof AdminApiError ? cause.message : "Could not save that tier's rate.",
      );
    } finally {
      setSavingSlug(null);
    }
  }

  return (
    <div className="flex max-w-lg flex-col gap-10">
      <p className="text-13.5 text-secondary">
        Postage for each delivery tier, the fallback rate, and when delivery is waived.
      </p>

      {loading ? (
        <AdminFormSkeleton fields={4} />
      ) : (
        <>
          <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
            <Input
              label="Flat rate (৳)"
              hint="Quoted only before a customer has picked their area — every order is priced by its tier."
              inputMode="decimal"
              value={form.flatRateTaka}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, flatRateTaka: event.target.value }))
              }
            />
            <Input
              label="Free delivery threshold (৳)"
              hint="Postage is waived once the subtotal reaches this, in every tier."
              inputMode="decimal"
              value={form.freeDeliveryThresholdTaka}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, freeDeliveryThresholdTaka: event.target.value }))
              }
            />

            {error ? <p className="text-13.5 text-clay">{error}</p> : null}

            {meta ? (
              <p className="text-caption text-secondary">
                {meta.source === "database"
                  ? `Saved${meta.updatedByEmail ? ` by ${meta.updatedByEmail}` : ""}${
                      meta.updatedAt ? ` on ${new Date(meta.updatedAt).toLocaleString()}` : ""
                    }.`
                  : "Still using the environment's defaults — save to override."}
              </p>
            ) : null}

            <Button type="submit" size="sm" disabled={saving} className="self-start">
              {saving ? "Saving…" : "Save"}
            </Button>
          </form>

          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-h4 text-ink font-serif">Delivery tiers</h2>
              <p className="text-13.5 text-secondary mt-1">
                The price of a parcel up to 0.5 kg in each Pathao tier. Heavier parcels add the
                fixed steps shown under each one. Leave a field blank to use Pathao&rsquo;s
                published rate.
              </p>
            </div>

            <div className="flex flex-col gap-5">
              {shippingTiers.map((tier) => {
                const slug = TIER_REGION_SLUG[tier];
                const region = regions.find((row) => row.slug === slug);
                const raw = regionRates[slug]?.trim() ?? "";
                const preview = raw === "" ? null : Math.round(Number(raw) * 100);

                return (
                  <div key={tier} className="flex flex-col gap-1.5">
                    <div className="flex items-end gap-3">
                      <Input
                        label={TIER_NAMES[tier]}
                        inputMode="decimal"
                        placeholder={String(RATE_LADDER[tier].startCents / 100)}
                        value={regionRates[slug] ?? ""}
                        onChange={(event) =>
                          setRegionRates((prev) => ({ ...prev, [slug]: event.target.value }))
                        }
                        fieldClassName="flex-1"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={savingSlug === slug}
                        onClick={() => void saveTier(tier)}
                      >
                        {savingSlug === slug ? "Saving…" : region ? "Save" : "Set up"}
                      </Button>
                    </div>
                    <p className="text-caption text-secondary">{TIER_COVERS[tier]}</p>
                    <p className="text-caption text-secondary">
                      {Number.isNaN(preview) ? "Enter a number." : ladderLine(tier, preview)}
                      {region && !region.isActive ? " · switched off, checkout refuses it" : ""}
                      {region ? "" : " · not set up yet, charging the published rate"}
                    </p>
                  </div>
                );
              })}
            </div>

            {regionsError ? <p className="text-13.5 text-clay">{regionsError}</p> : null}
          </div>
        </>
      )}
    </div>
  );
}
