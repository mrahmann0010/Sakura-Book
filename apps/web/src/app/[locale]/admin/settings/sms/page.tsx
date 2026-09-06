"use client";

import { useEffect, useState } from "react";
import type { AdminSmsSettings } from "@sakura/contracts";

import { useSettingsChecking } from "@/components/admin/settings-shell";
import { Notice, Radio, RadioGroup } from "@/components/ui";
import { AdminApiError, getAdminSmsSettings, updateAdminSmsSettings } from "@/lib/api/admin";

/** "default" defers to the gateway app's own sim_selection_mode setting. */
type SimChoice = "default" | "1" | "2" | "3";

function choiceOf(simNumber: AdminSmsSettings["simNumber"]): SimChoice {
  return simNumber === null ? "default" : (String(simNumber) as SimChoice);
}

/**
 * Which SIM the gateway phone sends from — shop-wide, saved to the database.
 *
 * This used to be a radio on the Send SMS page itself, which reset to
 * "default" on every refresh because it lived only in that page's component
 * state. A SIM choice is a fact about the phone doing this job, not something
 * to reselect per message, so it moved here: set once, it holds until someone
 * deliberately changes it.
 *
 * The SMS tab of Shop Settings — the sidebar entry, the gate, and the page
 * heading all live in `AdminSettingsShell`.
 */
export default function AdminSmsSettingsPage() {
  const checking = useSettingsChecking();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<Pick<AdminSmsSettings, "updatedAt" | "updatedByEmail"> | null>(
    null,
  );
  const [choice, setChoice] = useState<SimChoice>("default");

  useEffect(() => {
    if (checking) return;

    let cancelled = false;

    getAdminSmsSettings()
      .then((settings) => {
        if (cancelled) return;
        setChoice(choiceOf(settings.simNumber));
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

  async function save(next: SimChoice) {
    setChoice(next);
    setSaving(true);
    setError(null);

    try {
      const simNumber = next === "default" ? null : (Number(next) as 1 | 2 | 3);
      const updated = await updateAdminSmsSettings({ simNumber });
      setChoice(choiceOf(updated.simNumber));
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
        Which SIM slot the gateway phone sends from. Applies to every SMS the shop sends — the Send
        SMS panel and anything else that texts through it. Changing it here takes effect on the next
        message; it is not something staff choose per send.
      </p>

      {loading ? (
        <p className="text-13.5 text-secondary">Loading…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <RadioGroup name="sim" label="Send from">
            <Radio
              checked={choice === "default"}
              disabled={saving}
              onChange={() => void save("default")}
              description="Let the gateway app decide, per its own SIM selection setting."
            >
              Gateway default
            </Radio>
            <Radio checked={choice === "1"} disabled={saving} onChange={() => void save("1")}>
              SIM 1
            </Radio>
            <Radio checked={choice === "2"} disabled={saving} onChange={() => void save("2")}>
              SIM 2
            </Radio>
            <Radio checked={choice === "3"} disabled={saving} onChange={() => void save("3")}>
              SIM 3
            </Radio>
          </RadioGroup>

          {error ? <Notice tone="error">{error}</Notice> : null}

          <p className="text-caption text-secondary">
            {saving
              ? "Saving…"
              : meta?.updatedByEmail || meta?.updatedAt
                ? `Last changed${meta.updatedByEmail ? ` by ${meta.updatedByEmail}` : ""}${
                    meta.updatedAt ? ` on ${new Date(meta.updatedAt).toLocaleString()}` : ""
                  }.`
                : "Not yet set — the gateway app's own default decides."}
          </p>
        </div>
      )}
    </div>
  );
}
