"use client";

import { AdminAppearancePicker } from "@/components/admin/theme-control";

/**
 * How the panel looks, on this device.
 *
 * The odd one out among the Shop Settings tabs: every other tab writes to the
 * API and changes what customers see. This one writes to localStorage and
 * changes nothing outside the browser it is set in — which is the point, and
 * why the note below says so plainly rather than leaving someone to wonder why
 * their colleague's screen did not follow.
 *
 * It is a tab here anyway because this is where a setting is looked for. The
 * sidebar carries the same switch for when it is wanted mid-task; both drive
 * the one store in `lib/admin-theme.ts`, so they are never out of step.
 */
export default function AdminAppearanceSettingsPage() {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h2 className="text-h4 text-ink font-serif">Panel appearance</h2>
        <p className="text-13.5 text-secondary mt-1">
          Saved on this device, not on your account — this computer and your phone can each use
          whichever reads better where you are.
        </p>
      </div>

      <AdminAppearancePicker />

      <p className="text-caption text-muted border-rule border-t pt-4">
        Only the admin panel follows this setting. The shop keeps its own appearance for customers.
      </p>
    </div>
  );
}
