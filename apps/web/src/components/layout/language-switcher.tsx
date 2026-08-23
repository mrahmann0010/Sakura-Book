"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

import { locales, localeLabels, isLocale, type Locale } from "@/i18n/settings";
import { cn } from "@/lib/utils";
import { iconButton } from "@/lib/variants";

/**
 * Locale picker for the nav bar.
 *
 * Below the tablet floor it collapses to a globe the size of the theme toggle
 * beside it. The full label — "বাংলা", "English", "日本語" — is the widest
 * thing in the bar at 375px, and with it there the four nav items could not
 * fit and the bar became a horizontal scroller on a phone: the reader had to
 * swipe a header to find "Track Order".
 *
 * It is still one native `<select>` at every width, not an icon button that
 * opens something on mobile and a select on desktop. On mobile the select is
 * stretched invisibly over the glyph, so a tap opens the platform's own locale
 * list — which on a phone is a full-height sheet with real Bengali and
 * Japanese glyphs, better than anything a custom menu would give — and the
 * control keeps one accessible name, one value and one change handler.
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { i18n, t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();

  const current = isLocale(i18n.resolvedLanguage ?? "")
    ? (i18n.resolvedLanguage as Locale)
    : locales[0];

  function switchTo(locale: Locale) {
    const segments = pathname.split("/");
    segments[1] = locale;
    router.push(segments.join("/") || "/");
  }

  return (
    <label
      className={cn(
        "text-caption text-secondary group relative inline-flex shrink-0 items-center",
        className,
      )}
    >
      {/* Names the select — it is nested inside this label, so no `htmlFor` is
          needed and no `aria-label` on the select, which would only override
          this and say the same thing twice. */}
      <span className="sr-only">{t("language.label")}</span>

      {/* The mobile face. Not a button: the real control is the select laid
          invisibly over it. An `opacity-0` select paints no focus ring of its
          own, so the ring is drawn here off the group's `:has()` — without it a
          keyboard reaches the picker with nothing on screen to show it. */}
      <span
        aria-hidden
        className={cn(
          iconButton({ variant: "ghost", size: "sm" }),
          "size-8 sm:hidden",
          "group-has-[select:focus-visible]:outline-ink group-has-[select:focus-visible]:outline-2",
          "group-has-[select:focus-visible]:outline-offset-2",
        )}
      >
        <GlobeIcon />
      </span>

      <select
        value={current}
        onChange={(event) => switchTo(event.target.value as Locale)}
        className={cn(
          /* Mobile: invisible but present, covering the glyph exactly. The
             44px touch target comes from the nav bar's own padding around the
             32px box, the same way the theme toggle beside it gets one. */
          "absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0",
          /* Tablet and up: back to the visible pill it has always been. The
             border is `ink` because that is what it already rendered as —
             Tailwind's default border colour is `currentColor` and this select
             sets `text-ink`. */
          "sm:text-caption sm:text-ink sm:static sm:h-auto sm:w-auto sm:opacity-100",
          "sm:border-ink sm:appearance-auto sm:rounded-full sm:border sm:px-3 sm:py-1",
        )}
      >
        {locales.map((locale) => (
          <option key={locale} value={locale}>
            {localeLabels[locale]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Meridians on a circle — the one glyph that means "language" without being a
    flag, which would name a country rather than a language. */
function GlobeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M2.75 10h14.5M10 2.75c1.9 2 2.9 4.45 2.9 7.25S11.9 15.25 10 17.25c-1.9-2-2.9-4.45-2.9-7.25S8.1 4.75 10 2.75Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
