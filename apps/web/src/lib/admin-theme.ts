"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * localStorage key: which palette the panel wears on *this* device.
 *
 * Deliberately not on the account. Two people share one admin login here, and
 * one of them works a bright shop counter in the afternoon while the other
 * closes the books at night. A server-side preference would have them
 * overwriting each other's screens; a device-local one lets the laptop and the
 * phone disagree, which is the honest answer — the right palette is a fact
 * about the room, not about the user.
 */
export const ADMIN_THEME_KEY = "sakura-admin-theme";

/**
 * `system` defers to the OS. It is offered but not the default: the panel is
 * designed light, and inheriting a phone's blanket night mode into a screen
 * where someone is reading order totals is not a choice anybody made.
 */
export type AdminThemePreference = "light" | "dark" | "system";

export const ADMIN_THEME_DEFAULT: AdminThemePreference = "light";

function isPreference(value: string | null): value is AdminThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * Reads the stored preference, falling back to the default for anything
 * unreadable — a private window, cleared site data, or a value hand-edited to
 * something this build has never heard of.
 */
export function readAdminTheme(): AdminThemePreference {
  try {
    const stored = window.localStorage.getItem(ADMIN_THEME_KEY);
    return isPreference(stored) ? stored : ADMIN_THEME_DEFAULT;
  } catch {
    return ADMIN_THEME_DEFAULT;
  }
}

/**
 * Puts the preference on <html>, where `admin-theme.css` is watching for it.
 *
 * `system` removes the attribute rather than resolving the media query here,
 * so the OS switching at dusk is picked up by CSS with no JavaScript involved.
 */
export function applyAdminTheme(preference: AdminThemePreference): void {
  const root = document.documentElement;
  if (preference === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", preference);
}

/* --------------------------------------------------------------------------
   A one-value store, so the sidebar control and the Appearance tab are the
   same switch rather than two that drift apart. `storage` is in the
   subscription too: the panel open in a second tab follows along.
   -------------------------------------------------------------------------- */

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== ADMIN_THEME_KEY) return;
    applyAdminTheme(readAdminTheme());
    listener();
  };

  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function setAdminTheme(preference: AdminThemePreference): void {
  try {
    window.localStorage.setItem(ADMIN_THEME_KEY, preference);
  } catch {
    // A browser refusing to store it still gets the palette it asked for for
    // the rest of this session; only the memory of it is lost.
  }
  applyAdminTheme(preference);
  emit();
}

/**
 * The current preference and a setter.
 *
 * `useSyncExternalStore` with a distinct server snapshot rather than an
 * effect: these pages are prerendered, so reading localStorage during render
 * would be a hydration mismatch. The server snapshot is the default, which is
 * also what the no-flash script in `admin/layout.tsx` assumes when nothing is
 * stored — the two agree, so the first paint is never wrong.
 */
export function useAdminTheme(): [AdminThemePreference, (next: AdminThemePreference) => void] {
  const preference = useSyncExternalStore(subscribe, readAdminTheme, () => ADMIN_THEME_DEFAULT);
  const set = useCallback((next: AdminThemePreference) => setAdminTheme(next), []);
  return [preference, set];
}
