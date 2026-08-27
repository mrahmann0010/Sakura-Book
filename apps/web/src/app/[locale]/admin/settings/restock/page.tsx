"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { AdminRestockSchedule } from "@sakura/contracts";

import { AdminShell } from "@/components/admin/admin-shell";
import { Button, Input } from "@/components/ui";
import { AdminApiError, getAdminRestockSchedule, updateAdminRestockSchedule } from "@/lib/api/admin";
import { useAdminGate } from "@/lib/use-admin-gate";

/**
 * The reopening date announced on /notify.
 *
 * This used to be a constant in the notify page's source, which meant moving a
 * date customers had been given required a developer and a deploy — on exactly
 * the kind of day (the printer has slipped, the stock is late) when neither is
 * available. It is shop-wide: every waitlist signup is for the same reopening,
 * and a per-title date would live on the book, not here.
 *
 * The field is a native date input, so the value it produces is already the
 * `YYYY-MM-DD` the contract wants — no parsing, and no month/day ambiguity
 * between whoever types it and whoever reads it back.
 */
export default function AdminRestockSettingsPage() {
  const { checking } = useAdminGate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<Pick<
    AdminRestockSchedule,
    "updatedAt" | "updatedByEmail"
  > | null>(null);
  /** "" is the empty date input, which maps to null — "announce no date". */
  const [reopenDate, setReopenDate] = useState("");

  useEffect(() => {
    if (checking) return;

    let cancelled = false;

    getAdminRestockSchedule()
      .then((schedule) => {
        if (cancelled) return;
        setReopenDate(schedule.reopenDate ?? "");
        setMeta(schedule);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof AdminApiError ? cause.message : "Could not load the reopening date.",
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
      const updated = await updateAdminRestockSchedule({ reopenDate: reopenDate || null });
      setReopenDate(updated.reopenDate ?? "");
      setMeta(updated);
    } catch (cause) {
      setError(
        cause instanceof AdminApiError ? cause.message : "Could not save the reopening date.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminShell checking={checking}>
      <div className="flex max-w-lg flex-col gap-6">
        <div>
          <h1 className="text-h2 text-ink font-serif">Reopening Date</h1>
          <p className="text-13.5 text-secondary mt-1">
            The date shown on the notify page, where customers join the restock waitlist. It
            applies to every book. Clear the field to take the announcement down — the page then
            omits the line rather than showing a blank date.
          </p>
        </div>

        {loading ? (
          <p className="text-13.5 text-secondary">Loading…</p>
        ) : (
          <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
            <Input
              type="date"
              label="Ordering reopens on"
              hint="Shown to customers in their own language — Bangla readers see the Bangla month name."
              value={reopenDate}
              onChange={(event) => setReopenDate(event.target.value)}
            />

            {error ? <p className="text-13.5 text-clay">{error}</p> : null}

            <p className="text-caption text-secondary">
              {reopenDate
                ? "The notify page announces this date."
                : "No date announced — the notify page omits the reopening line."}
              {meta?.updatedByEmail || meta?.updatedAt
                ? ` Last changed${meta.updatedByEmail ? ` by ${meta.updatedByEmail}` : ""}${
                    meta.updatedAt ? ` on ${new Date(meta.updatedAt).toLocaleString()}` : ""
                  }.`
                : null}
            </p>

            <Button type="submit" size="sm" disabled={saving} className="self-start">
              {saving ? "Saving…" : "Save"}
            </Button>
          </form>
        )}
      </div>
    </AdminShell>
  );
}
