export const locales = ["en", "bn", "ja"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "bn";

export const localeLabels: Record<Locale, string> = {
  en: "English",
  bn: "বাংলা",
  ja: "日本語",
};

export const defaultNamespace = "common";
export const namespaces = [defaultNamespace] as const;

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

export function getOptions(
  locale: Locale = defaultLocale,
  ns: string | string[] = defaultNamespace,
) {
  return {
    supportedLngs: locales,
    fallbackLng: defaultLocale,
    lng: locale,
    fallbackNS: defaultNamespace,
    defaultNS: defaultNamespace,
    ns,
  };
}
