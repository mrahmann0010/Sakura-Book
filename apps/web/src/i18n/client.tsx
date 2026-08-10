"use client";

import i18next from "i18next";
import resourcesToBackend from "i18next-resources-to-backend";
import { useEffect, type ReactNode } from "react";
import { I18nextProvider, initReactI18next, useTranslation } from "react-i18next";

import { getOptions, type Locale } from "./settings";

i18next
  .use(initReactI18next)
  .use(
    resourcesToBackend(
      (language: string, namespace: string) => import(`./locales/${language}/${namespace}.json`),
    ),
  )
  .init(getOptions());

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const { i18n } = useTranslation();

  useEffect(() => {
    if (i18n.resolvedLanguage !== locale) {
      void i18n.changeLanguage(locale);
    }
  }, [locale, i18n]);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
