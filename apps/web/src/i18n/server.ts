import { createInstance, type i18n } from "i18next";
import resourcesToBackend from "i18next-resources-to-backend";
import { initReactI18next } from "react-i18next/initReactI18next";

import { defaultNamespace, getOptions, type Locale } from "./settings";

async function initI18next(locale: Locale, ns: string | string[]): Promise<i18n> {
  const instance = createInstance();
  await instance
    .use(initReactI18next)
    .use(
      resourcesToBackend(
        (language: string, namespace: string) => import(`./locales/${language}/${namespace}.json`),
      ),
    )
    .init(getOptions(locale, ns));
  return instance;
}

export async function getTranslation(locale: Locale, ns: string | string[] = defaultNamespace) {
  const instance = await initI18next(locale, ns);
  return {
    t: instance.getFixedT(locale, Array.isArray(ns) ? ns[0] : ns),
    i18n: instance,
  };
}
