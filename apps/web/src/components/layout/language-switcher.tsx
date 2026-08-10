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
    <label className={cn("inline-flex items-center gap-2 text-caption text-secondary", className)}>
      <span className="sr-only">{t("language.label")}</span>
      <select
        value={current}
        onChange={(event) => switchTo(event.target.value as Locale)}
        className="rounded-full border border-hairline bg-transparent px-3 py-1 text-caption text-ink"
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
