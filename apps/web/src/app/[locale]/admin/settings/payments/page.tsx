"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { AdminPaymentNumbers } from "@sakura/contracts";

import { useSettingsChecking } from "@/components/admin/settings-shell";
import { Button, Input } from "@/components/ui";
import { AdminApiError, getAdminPaymentNumbers, updateAdminPaymentNumbers } from "@/lib/api/admin";

type FormState = {
  bkashNumber: string;
  rocketNumber: string;
  nagadNumber: string;
};

function fromNumbers(numbers: AdminPaymentNumbers): FormState {
  return {
    bkashNumber: numbers.bkashNumber,
    rocketNumber: numbers.rocketNumber,
    nagadNumber: numbers.nagadNumber,
  };
}

/**
 * The only place these numbers may be changed.
 *
 * Checkout used to let anyone editing the page correct the number shown
 * there — a stopgap from before this page existed, and one that let a
 * customer, not just staff, change what they saw in their own browser. This
 * form is what replaced it: the numbers now live in the database, checkout
 * only ever reads them, and only a signed-in ADMIN can write them here.
 *
 * The Payments tab of Shop Settings — the sidebar entry, the gate, and the
 * page heading all live in `AdminSettingsShell`.
 */
export default function AdminPaymentSettingsPage() {
  const checking = useSettingsChecking();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<Pick<
    AdminPaymentNumbers,
    "source" | "updatedAt" | "updatedByEmail"
  > | null>(null);
  const [form, setForm] = useState<FormState>({
    bkashNumber: "",
    rocketNumber: "",
    nagadNumber: "",
  });

  useEffect(() => {
    if (checking) return;

    let cancelled = false;

    getAdminPaymentNumbers()
      .then((numbers) => {
        if (cancelled) return;
        setForm(fromNumbers(numbers));
        setMeta(numbers);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof AdminApiError ? cause.message : "Could not load payment settings.",
        );
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
      const updated = await updateAdminPaymentNumbers({
        bkashNumber: form.bkashNumber,
        rocketNumber: form.rocketNumber,
        nagadNumber: form.nagadNumber,
      });
      setForm(fromNumbers(updated));
      setMeta(updated);
    } catch (cause) {
      setError(cause instanceof AdminApiError ? cause.message : "Could not save payment settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex max-w-lg flex-col gap-6">
      <p className="text-13.5 text-secondary">
        The bKash, Rocket, and Nagad numbers customers see at checkout. Changing them here is the
        only way to change them — checkout only displays and copies these, it cannot edit them.
      </p>

      {loading ? (
        <p className="text-13.5 text-secondary">Loading…</p>
      ) : (
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
          <Input
            label="bKash number"
            inputMode="tel"
            value={form.bkashNumber}
            onChange={(event) => setForm((prev) => ({ ...prev, bkashNumber: event.target.value }))}
          />
          <Input
            label="Rocket number"
            inputMode="tel"
            value={form.rocketNumber}
            onChange={(event) => setForm((prev) => ({ ...prev, rocketNumber: event.target.value }))}
          />
          <Input
            label="Nagad number"
            inputMode="tel"
            value={form.nagadNumber}
            onChange={(event) => setForm((prev) => ({ ...prev, nagadNumber: event.target.value }))}
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
      )}
    </div>
  );
}
