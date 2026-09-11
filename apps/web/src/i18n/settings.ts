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
    interpolation: {
      /* Off because React already escapes everything it renders, and doing it
         twice is visible: i18next turned the "/" in a Japanese date into
         "&#x2F;", React then escaped that "&", and the customer read
         "2026&#x2F;09&#x2F;10" on the page. The same double-escape hits any
         interpolated value carrying an apostrophe or an ampersand — a book
         title, a customer's name.

         Safe only because nothing feeds a translation to
         dangerouslySetInnerHTML and there is no <Trans> in the app; if either
         changes, this has to be reconsidered at that call site rather than
         here. */
      escapeValue: false,
    },
  };
}
