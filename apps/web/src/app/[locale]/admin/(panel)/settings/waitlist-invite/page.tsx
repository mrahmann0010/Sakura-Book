"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { AdminWaitlistInviteSettings } from "@sakura/contracts";

import { useAdminChecking } from "@/components/admin/admin-shell";
import { Button, Input, Select } from "@/components/ui";
import {
  AdminApiError,
  getAdminWaitlistInviteSettings,
  updateAdminWaitlistInviteSettings,
} from "@/lib/api/admin";
import type { WaitlistInviteLanguage } from "@sakura/contracts";

const DEFAULT_TTL_HOURS = 48;
const DEFAULT_LANGUAGE: WaitlistInviteLanguage = "customer";

const LANGUAGE_OPTIONS: { value: WaitlistInviteLanguage; label: string }[] = [
  { value: "customer", label: "Customer's preferred language (waitlist signup)" },
  { value: "en", label: "English" },
  { value: "bn", label: "Bangla" },
];

/**
 * How long a waitlist invite link stays redeemable after the panel sends it.
 *
 * Same shape as the Reopening Date tab: one field, an explicit Save, and a
 * "last changed by" line. The value is shop policy — how much time a
 * customer gets before their reserved slot recycles to the next person in
 * line — not something staff choose per send.
 *
 * The Waitlist Invites tab of Shop Settings — the sidebar entry, the gate,
 * and the page heading all live in `AdminSettingsShell`.
 */
export default function AdminWaitlistInviteSettingsPage() {
  const checking = useAdminChecking();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<Pick<
    AdminWaitlistInviteSettings,
    "updatedAt" | "updatedByEmail"
  > | null>(null);
  const [ttlHours, setTtlHours] = useState(String(DEFAULT_TTL_HOURS));
  const [language, setLanguage] = useState<WaitlistInviteLanguage>(DEFAULT_LANGUAGE);

  useEffect(() => {
    if (checking) return;

    let cancelled = false;

    getAdminWaitlistInviteSettings()
      .then((settings) => {
        if (cancelled) return;
        setTtlHours(String(settings.ttlHours ?? DEFAULT_TTL_HOURS));
        setLanguage(settings.language ?? DEFAULT_LANGUAGE);
        setMeta(settings);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof AdminApiError ? cause.message : "Could not load the setting.");
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
      const updated = await updateAdminWaitlistInviteSettings({
        ttlHours: Number(ttlHours),
        language,
      });
      setTtlHours(String(updated.ttlHours ?? DEFAULT_TTL_HOURS));
      setLanguage(updated.language ?? DEFAULT_LANGUAGE);
      setMeta(updated);
    } catch (cause) {
      setError(cause instanceof AdminApiError ? cause.message : "Could not save the setting.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex max-w-lg flex-col gap-6">
      <p className="text-13.5 text-secondary">
        How many hours a waitlist invite link stays redeemable after it&apos;s sent from the
        Waitlist panel. After it expires, the reserved slot is free for staff to offer to the next
        person in line.
      </p>

      {loading ? (
        <p className="text-13.5 text-secondary">Loading…</p>
      ) : (
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
          <Input
            type="number"
            min={1}
            max={720}
            label="Invite link expires after (hours)"
            hint="1–720 hours (up to 30 days)."
            value={ttlHours}
            onChange={(event) => setTtlHours(event.target.value)}
          />

          <Select
            label="Send invite SMS in"
            hint="Which language the invite text is written in."
            options={LANGUAGE_OPTIONS}
            value={language}
            onChange={(event) => setLanguage(event.target.value as WaitlistInviteLanguage)}
          />

          {error ? <p className="text-13.5 text-clay">{error}</p> : null}

          <p className="text-caption text-secondary">
            {meta?.updatedByEmail || meta?.updatedAt
              ? `Last changed${meta.updatedByEmail ? ` by ${meta.updatedByEmail}` : ""}${
                  meta.updatedAt ? ` on ${new Date(meta.updatedAt).toLocaleString()}` : ""
                }.`
              : `Not yet set — invites default to ${DEFAULT_TTL_HOURS} hours.`}
          </p>

          <Button type="submit" size="sm" disabled={saving} className="self-start">
            {saving ? "Saving…" : "Save"}
          </Button>
        </form>
      )}
    </div>
  );
}
