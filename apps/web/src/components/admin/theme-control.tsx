"use client";

import { useId } from "react";

import { MonitorIcon, MoonIcon, SunIcon } from "@/components/admin/icons";
import { useAdminTheme, type AdminThemePreference } from "@/lib/admin-theme";

/**
 * The three choices, in the order they are reached for: the palette the panel
 * is designed in, its night counterpart, then the deferral.
 */
const OPTIONS = [
  {
    value: "light",
    label: "Light",
    Icon: SunIcon,
    description: "Warm paper. What the panel is designed in, and best under shop lighting.",
  },
  {
    value: "dark",
    label: "Dark",
    Icon: MoonIcon,
    description: "Deep navy, for closing the books after hours.",
  },
  {
    value: "system",
    label: "Auto",
    Icon: MonitorIcon,
    description: "Follows this device's own light and dark setting, switching when it does.",
  },
] as const satisfies ReadonlyArray<{
  value: AdminThemePreference;
  label: string;
  Icon: typeof SunIcon;
  description: string;
}>;

/* --------------------------------------------------------------------------
   The rail's switch — one click from any screen.

   Radio inputs rather than buttons: this is one setting with three values, and
   arrow-key traversal within the group is what a keyboard expects of that. The
   inputs are transparent and stretched over their segment, so the hit target
   is the whole segment rather than a hidden control somewhere inside it.
   -------------------------------------------------------------------------- */

export function AdminRailThemeSwitch() {
  const [preference, setPreference] = useAdminTheme();
  const name = useId();

  return (
    <fieldset>
      <legend className="text-10 tracking-label text-rail-muted mb-2 px-1 uppercase">
        Appearance
      </legend>

      <div className="bg-rail-hover border-rail-rule grid grid-cols-3 gap-0.5 rounded-lg border p-0.5">
        {OPTIONS.map(({ value, label, Icon }) => {
          const active = preference === value;

          return (
            <label
              key={value}
              className={`rounded-control relative flex cursor-pointer flex-col items-center gap-1 px-1 py-2 transition-colors ${
                active
                  ? "bg-rail-active text-rail-ink font-medium"
                  : "text-rail-secondary hover:text-rail-ink"
              }`}
            >
              <input
                type="radio"
                name={name}
                value={value}
                checked={active}
                onChange={() => setPreference(value)}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
              />
              <Icon size={16} />
              <span className="text-10.5 leading-none">{label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/* --------------------------------------------------------------------------
   The Appearance tab's picker.

   Each option shows the palette it selects rather than naming it, because
   "Light" and "Dark" describe a direction and not this particular warm paper
   or that particular navy. The swatch colours are literal on purpose: a
   preview drawn in `var(--page)` would show whichever theme is already on,
   three times over, which is the one thing a preview must not do.

   Keep these in step with `styles/admin-theme.css`.
   -------------------------------------------------------------------------- */

const SWATCHES: Record<
  AdminThemePreference,
  { rail: string; page: string; surface: string; rule: string; accent: string; ink: string }
> = {
  light: {
    rail: "#211f1c",
    page: "#f5f2ea",
    surface: "#ffffff",
    rule: "#d8cfba",
    accent: "#ab5030",
    ink: "#1c1b18",
  },
  dark: {
    rail: "#080f1c",
    page: "#0b1220",
    surface: "#121a2e",
    rule: "#2c3860",
    accent: "#e08260",
    ink: "#f2f4fa",
  },
  /* Auto is drawn as the light palette; the seam down the middle of the card
     is what says "whichever this device is asking for". */
  system: {
    rail: "#211f1c",
    page: "#f5f2ea",
    surface: "#ffffff",
    rule: "#d8cfba",
    accent: "#ab5030",
    ink: "#1c1b18",
  },
};

function Swatch({ value }: { value: AdminThemePreference }) {
  const s = SWATCHES[value];
  const dark = SWATCHES.dark;

  return (
    <div
      aria-hidden
      className="relative flex h-[74px] w-full overflow-hidden rounded-md"
      style={{ backgroundColor: s.page, border: `1px solid ${s.rule}` }}
    >
      {/* The rail, at the width it actually occupies on a desktop screen. */}
      <div
        className="flex w-1/4 shrink-0 flex-col gap-1.5 p-1.5"
        style={{ backgroundColor: s.rail }}
      >
        <span
          className="block h-1 w-3/4 rounded-full"
          style={{ backgroundColor: s.ink, opacity: 0.85 }}
        />
        <span
          className="block h-1 w-full rounded-full"
          style={{ backgroundColor: s.ink, opacity: 0.3 }}
        />
        <span
          className="block h-1 w-full rounded-full"
          style={{ backgroundColor: s.ink, opacity: 0.3 }}
        />
      </div>

      {/* A card on the work area, with the accent doing what the accent does. */}
      <div className="flex-1 p-2">
        <div
          className="flex h-full w-full flex-col justify-between rounded-[3px] p-1.5"
          style={{ backgroundColor: s.surface, border: `1px solid ${s.rule}` }}
        >
          <span
            className="block h-1 w-1/2 rounded-full"
            style={{ backgroundColor: s.ink, opacity: 0.7 }}
          />
          <span className="block h-1 w-full rounded-full" style={{ backgroundColor: s.rule }} />
          <span className="block h-1.5 w-1/3 rounded-full" style={{ backgroundColor: s.accent }} />
        </div>
      </div>

      {/* Auto only: the right half in the other palette, split on the diagonal. */}
      {value === "system" ? (
        <div
          className="absolute inset-0 flex"
          style={{ clipPath: "polygon(58% 0, 100% 0, 100% 100%, 42% 100%)" }}
        >
          <div className="flex-1 p-2" style={{ backgroundColor: dark.page }}>
            <div
              className="flex h-full w-full flex-col justify-between rounded-[3px] p-1.5"
              style={{ backgroundColor: dark.surface, border: `1px solid ${dark.rule}` }}
            >
              <span
                className="block h-1 w-1/2 rounded-full"
                style={{ backgroundColor: dark.ink, opacity: 0.7 }}
              />
              <span
                className="block h-1 w-full rounded-full"
                style={{ backgroundColor: dark.rule }}
              />
              <span
                className="block h-1.5 w-1/3 rounded-full"
                style={{ backgroundColor: dark.accent }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function AdminAppearancePicker() {
  const [preference, setPreference] = useAdminTheme();
  const name = useId();

  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">Panel appearance</legend>

      <div className="grid gap-4 sm:grid-cols-3">
        {OPTIONS.map(({ value, label, Icon, description }) => {
          const active = preference === value;

          return (
            <label
              key={value}
              className={`rounded-container relative flex cursor-pointer flex-col gap-3 border p-3 transition-colors ${
                active
                  ? "border-clay bg-surface"
                  : "border-rule bg-surface hover:border-rule-strong"
              }`}
            >
              <input
                type="radio"
                name={name}
                value={value}
                checked={active}
                onChange={() => setPreference(value)}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
              />

              <Swatch value={value} />

              <div className="flex items-center gap-2">
                <Icon size={16} className={active ? "text-clay" : "text-secondary"} />
                <span className={`text-13.5 font-medium ${active ? "text-ink" : "text-body"}`}>
                  {label}
                </span>
                {/* The word, not only the clay border — principle 03. */}
                {active ? (
                  <span className="text-10 tracking-label text-clay ml-auto uppercase">On</span>
                ) : null}
              </div>

              <p className="text-caption text-secondary">{description}</p>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
