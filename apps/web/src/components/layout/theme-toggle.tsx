"use client";

import { useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";
import { iconButton } from "@/lib/variants";

type Theme = "light" | "dark";

const STORAGE_KEY = "theme";

/* useSyncExternalStore rather than useState+useEffect (same pattern as
   useScrolledPast/usePrefersReducedMotion in floating-nav.tsx): the theme
   lives on `<html data-theme>`, set by the root layout's no-flash script
   before hydration, so reading it in a snapshot avoids the flash a
   useState-then-effect pair would cause. There is no native browser event
   for "someone clicked this button", so `toggle` calls `notify` itself after
   writing the attribute. */
let listeners: Array<() => void> = [];

function subscribe(onChange: () => void) {
  listeners.push(onChange);
  return () => {
    listeners = listeners.filter((listener) => listener !== onChange);
  };
}

function notify() {
  for (const listener of listeners) listener();
}

function getSnapshot(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

/** Matches the no-flash script's default — light unless a visitor has opted
    into dark, so server and client agree before the script has run. */
function getServerSnapshot(): Theme {
  return "light";
}

/**
 * The storefront's manual light/dark switch. The root layout's no-flash
 * script already forces `data-theme="light"` before paint unless the visitor
 * has an explicit "dark" saved — dark is something a visitor opts into here,
 * not something their OS decides for them.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* Private browsing or storage disabled — the toggle still works for
         this page load, it just won't be remembered on the next visit. */
    }
    notify();
  }

  const isDark = theme === "dark";
  const label = isDark ? "Switch to light theme" : "Switch to dark theme";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={cn(iconButton({ variant: "ghost", size: "sm" }), className)}
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="3.75" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10 1.75v2.5M10 15.75v2.5M3.05 3.05l1.77 1.77M15.18 15.18l1.77 1.77M1.75 10h2.5M15.75 10h2.5M3.05 16.95l1.77-1.77M15.18 4.82l1.77-1.77"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M17.5 11.75A7.5 7.5 0 1 1 8.25 2.5a6 6 0 0 0 9.25 9.25Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
