"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

import { locales, localeLabels, isLocale, type Locale } from "@/i18n/settings";
import { cn } from "@/lib/utils";

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
    <label className={cn("text-caption text-secondary inline-flex items-center gap-2", className)}>
      <span className="sr-only">{t("language.label")}</span>
      <select
        value={current}
        onChange={(event) => switchTo(event.target.value as Locale)}
        className="border-hairline text-caption text-ink rounded-full border bg-transparent px-3 py-1"
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
