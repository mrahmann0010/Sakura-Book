import type { Metadata } from "next";
import { Lora, Public_Sans } from "next/font/google";
import "../globals.css";

import { I18nProvider } from "@/i18n/client";
import { locales, type Locale } from "@/i18n/settings";
import { QueryProvider } from "@/lib/api/query-provider";
import { StoreProvider } from "@/store/provider";

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

export const metadata: Metadata = {
  title: "Marginalia",
  description: "A small catalog of books, chosen by hand and posted from Bristol.",
};

export default async function RootLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = (await params) as { locale: Locale };

  return (
    <html lang={locale} className={`${lora.variable} ${publicSans.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <StoreProvider>
          <QueryProvider>
            <I18nProvider locale={locale}>{children}</I18nProvider>
          </QueryProvider>
        </StoreProvider>
      </body>
    </html>
  );
}
