"use client";

import i18next from "i18next";
import { useEffect, type ReactNode } from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";

import bn from "./locales/bn/common.json";
import en from "./locales/en/common.json";
import ja from "./locales/ja/common.json";
import { defaultNamespace, getOptions, locales, type Locale } from "./settings";

/* --------------------------------------------------------------------------
   Client-side i18n.

   The three locale files are imported statically and handed to i18next as
   `resources`, rather than fetched through i18next-resources-to-backend.

   That backend loads a namespace with a dynamic `import()`, which is a promise
   — and `useTranslation` suspends while a namespace is loading. On the server
   there is nothing to resume it: a client component under a locale whose
   resources had not landed rendered *empty*, and the symptom was severe.
   `books/[slug]/not-found.tsx` server-rendered as a blank page — no heading,
   no explanation, no link out — and the catalog's filter rail server-rendered
   its English labels under /bn and /ja, then swapped after hydration.

   The cost of the change is all three locales in the client bundle, about
   24KB of JSON before compression. That buys correct markup on the first
   paint, in the right language, with no suspense boundary and no hydration
   swap. For three small files it is not a close call — code-splitting them is
   worth revisiting at ten locales, and would need a server-driven preload
   rather than a lazy backend either way.
   -------------------------------------------------------------------------- */

const resources = {
  en: { [defaultNamespace]: en },
  bn: { [defaultNamespace]: bn },
  ja: { [defaultNamespace]: ja },
} satisfies Record<Locale, unknown>;

void i18next.use(initReactI18next).init({
  ...getOptions(),
  resources,
  /* Nothing loads asynchronously any more, so nothing should ever suspend.
     Stated explicitly rather than left to the default: if a namespace is added
     later and does load lazily, this turns a silently blank server render back
     into a visible missing-key string. */
  react: { useSuspense: false },
});

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  /* Set during render, not in an effect. An effect does not run on the server,
     so the first HTML would be in the default locale no matter which segment
     was requested — and effects run after paint on the client too, which is
     the flash of English this used to produce on /bn and /ja.

     Safe to call during render because with resources in hand this is a
     synchronous field assignment on a module-level singleton, not a load. */
  if (locales.includes(locale) && i18next.language !== locale) {
    void i18next.changeLanguage(locale);
  }

  useEffect(() => {
    /* Belt and braces for client-side locale switches, where a changeLanguage
       during another component's render would be a bad citizen. */
    if (i18next.language !== locale) void i18next.changeLanguage(locale);
  }, [locale]);

  return <I18nextProvider i18n={i18next}>{children}</I18nextProvider>;
}
