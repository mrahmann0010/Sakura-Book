import type { Metadata } from "next";
import { Lora, Public_Sans } from "next/font/google";
import "../globals.css";

import { I18nProvider } from "@/i18n/client";
import { locales, type Locale } from "@/i18n/settings";
import { QueryProvider } from "@/lib/api/query-provider";
import { localeAlternates, siteUrl } from "@/lib/site";
import { StoreProvider } from "@/store/provider";
import { ScrollToTop } from "@/components/layout/scroll-to-top";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

/* Lora for titles and book names, italic for authors. */
const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  display: "swap",
});

/* Public Sans for all interface text. */
const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

/* Per-locale rather than a module constant, because `alternates` needs to know
   which locale it is the canonical of, and the title template has to be set
   somewhere every page inherits it. Pages below override `title` alone and get
   the template, the description and the Open Graph defaults for free. */
export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = (await params) as { locale: Locale };
  const description = "A small catalog of books, chosen by hand and posted from Bristol.";

  return {
    /* Makes every relative URL in metadata below — and in the pages — resolve
       against the real origin instead of being emitted as a path, which is not
       a valid og:url. */
    metadataBase: new URL(siteUrl()),
    title: {
      default: "Nihonova Books",
      template: "%s · Nihonova Books",
    },
    description,
    alternates: localeAlternates(locale),
    openGraph: {
      type: "website",
      siteName: "Nihonova Books",
      locale,
      title: "Nihonova Books",
      description,
      url: localeAlternates(locale).canonical,
    },
    twitter: { card: "summary_large_image" },
  };
}

export default async function RootLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = (await params) as { locale: Locale };

  return (
    <html lang={locale} className={`${lora.variable} ${publicSans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <StoreProvider>
          <QueryProvider>
            <I18nProvider locale={locale}>
              <ScrollToTop />
              {children}
            </I18nProvider>
          </QueryProvider>
        </StoreProvider>
      </body>
    </html>
  );
}
