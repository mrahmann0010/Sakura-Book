"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { AdminRegion, AdminShippingTerms } from "@sakura/contracts";

import { AdminShell } from "@/components/admin/admin-shell";
import { Button, Input, Select } from "@/components/ui";
import {
  AdminApiError,
  getAdminShippingTerms,
  listAdminRegions,
  updateAdminRegion,
  updateAdminShippingTerms,
} from "@/lib/api/admin";
import { bdDivisions } from "@/lib/bd-geo";
import { useAdminGate } from "@/lib/use-admin-gate";

type TermsForm = {
  originDivision: string;
  flatRateTaka: string;
  freeDeliveryThresholdTaka: string;
};

function fromTerms(terms: AdminShippingTerms): TermsForm {
  return {
    originDivision: terms.originDivision,
    flatRateTaka: String(terms.flatRateCents / 100),
    freeDeliveryThresholdTaka: String(terms.freeDeliveryThresholdCents / 100),
  };
}

function taka(cents: number | null): string {
  return cents === null ? "" : String(cents / 100);
}

/**
 * Where the shop ships from, and what postage costs.
 *
 * `originDivision` is what checkout's `deliveryZoneFor` (apps/web/src/lib/bd-geo.ts)
 * compares a customer's division against to pick `inside-dhaka` (same division
 * as the origin) or `outside-dhaka` (any other division) — the names are
 * historical, not literal, because the shop's shipment point moves. Changing
 * it here is what moves the zone boundary; the two region rows below are what
 * set the price on each side of it.
 */
export default function AdminShippingSettingsPage() {
  const { checking } = useAdminGate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<Pick<
    AdminShippingTerms,
    "source" | "updatedAt" | "updatedByEmail"
  > | null>(null);
  const [form, setForm] = useState<TermsForm>({
    originDivision: "dhaka",
    flatRateTaka: "",
    freeDeliveryThresholdTaka: "",
  });

  const [regions, setRegions] = useState<AdminRegion[]>([]);
  const [regionRates, setRegionRates] = useState<Record<string, string>>({});
  const [regionsError, setRegionsError] = useState<string | null>(null);
  const [savingSlug, setSavingSlug] = useState<string | null>(null);

  useEffect(() => {
    if (checking) return;

    let cancelled = false;

    Promise.all([getAdminShippingTerms(), listAdminRegions()])
      .then(([terms, regionList]) => {
        if (cancelled) return;
        setForm(fromTerms(terms));
        setMeta(terms);
        setRegions(regionList);
        setRegionRates(
          Object.fromEntries(regionList.map((region) => [region.slug, taka(region.deliveryCentsOverride)])),
        );
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof AdminApiError ? cause.message : "Could not load shipping settings.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [checking]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const updated = await updateAdminShippingTerms({
        originDivision: form.originDivision,
        flatRateCents: Math.round(Number(form.flatRateTaka) * 100),
        freeDeliveryThresholdCents: Math.round(Number(form.freeDeliveryThresholdTaka) * 100),
      });
      setForm(fromTerms(updated));
      setMeta(updated);
    } catch (cause) {
      setError(cause instanceof AdminApiError ? cause.message : "Could not save shipping settings.");
    } finally {
      setSaving(false);
    }
  }

  async function saveRegion(slug: string) {
    setSavingSlug(slug);
    setRegionsError(null);

    try {
      const raw = regionRates[slug]?.trim() ?? "";
      const updated = await updateAdminRegion(slug, {
        deliveryCentsOverride: raw === "" ? null : Math.round(Number(raw) * 100),
      });
      setRegions((prev) => prev.map((region) => (region.slug === slug ? updated : region)));
      setRegionRates((prev) => ({ ...prev, [slug]: taka(updated.deliveryCentsOverride) }));
    } catch (cause) {
      setRegionsError(cause instanceof AdminApiError ? cause.message : "Could not save that region's rate.");
    } finally {
      setSavingSlug(null);
    }
  }

  return (
    <AdminShell checking={checking}>
      <div className="flex max-w-lg flex-col gap-10">
        <div>
          <h1 className="text-h2 text-ink font-serif">Shipping Settings</h1>
          <p className="text-13.5 text-secondary mt-1">
            The division the shop currently ships from, the postage rates on each side of it, and
            when delivery is waived.
          </p>
        </div>

        {loading ? (
          <p className="text-13.5 text-secondary">Loading…</p>
        ) : (
          <>
            <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
              <Select
                label="Shipping from"
                hint="Customers in this division are charged the “inside” rate below; every other division is charged the “outside” rate."
                value={form.originDivision}
                onChange={(event) => setForm((prev) => ({ ...prev, originDivision: event.target.value }))}
                options={bdDivisions.map((division) => ({ value: division.value, label: division.label }))}
              />
              <Input
                label="Flat rate (৳)"
                hint="Fallback postage when a customer's zone can't be resolved."
                inputMode="decimal"
                value={form.flatRateTaka}
                onChange={(event) => setForm((prev) => ({ ...prev, flatRateTaka: event.target.value }))}
              />
              <Input
                label="Free delivery threshold (৳)"
                hint="Postage is waived once the subtotal reaches this."
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
                <h2 className="text-h4 text-ink font-serif">Region rates</h2>
                <p className="text-13.5 text-secondary mt-1">
                  What each zone is actually charged. Leave a field blank to fall back to the flat
                  rate above.
                </p>
              </div>

              <div className="flex flex-col gap-3">
                {regions.map((region) => (
                  <div key={region.slug} className="flex items-end gap-3">
                    <Input
                      label={region.name}
                      inputMode="decimal"
                      placeholder={form.flatRateTaka}
                      value={regionRates[region.slug] ?? ""}
                      onChange={(event) =>
                        setRegionRates((prev) => ({ ...prev, [region.slug]: event.target.value }))
                      }
                      fieldClassName="flex-1"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={savingSlug === region.slug}
                      onClick={() => void saveRegion(region.slug)}
                    >
                      {savingSlug === region.slug ? "Saving…" : "Save"}
                    </Button>
                  </div>
                ))}
              </div>

              {regionsError ? <p className="text-13.5 text-clay">{regionsError}</p> : null}
            </div>
          </>
        )}
      </div>
    </AdminShell>
  );
}
