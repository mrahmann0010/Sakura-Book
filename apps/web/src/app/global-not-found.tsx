import Link from "next/link";
import { Lora, Public_Sans } from "next/font/google";
import type { Metadata } from "next";

import "./globals.css";

import { EmptyState } from "@/components/domain";
import { Shell } from "@/components/layout";
import { LinkButton, Wordmark } from "@/components/ui";
import { defaultLocale } from "@/i18n/settings";

/* global-not-found — the documented escape hatch for a root layout that
   lives under a top-level dynamic segment ([locale]): there is no single
   layout to compose a 404 from, so this bypasses the tree entirely and has
   to bring its own fonts, styles and <html>/<body>. No `params` reach it
   either, so the locale is unknown — every link falls back to the default
   locale, same as a first-time visit with no locale in the URL yet. */

const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  display: "swap",
});

const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Page not found · Marginalia",
  description: "The page you are looking for does not exist.",
};

export default function GlobalNotFound() {
  const home = `/${defaultLocale}`;

  return (
    <html lang={defaultLocale} className={`${lora.variable} ${publicSans.variable} h-full antialiased`}>
      <body className="bg-page flex min-h-full flex-col">
        <header className="shell flex items-center py-8">
          <Link href={home}>
            <Wordmark />
          </Link>
        </header>

        <main className="flex flex-1 items-center justify-center">
          <Shell className="flex justify-center py-14">
            <EmptyState
              className="max-w-measure-lede text-center"
              eyebrow="404"
              title="This page has slipped off the shelf"
              description="We can't find what you're looking for. It may have sold out, moved, or never been shelved at all."
              action={<LinkButton href={home}>Back to the shop</LinkButton>}
            />
          </Shell>
        </main>
      </body>
    </html>
  );
}
