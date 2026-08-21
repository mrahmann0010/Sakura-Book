import Link from "next/link";
import { Lora, Public_Sans } from "next/font/google";
import type { Metadata } from "next";

import "./globals.css";

import { SiteFooter } from "@/components/layout";
import { LinkButton, Wordmark } from "@/components/ui";
import { footerColumns } from "@/lib/books";
import { localizeLinks } from "@/lib/routes";
import { defaultLocale } from "@/i18n/settings";

/* global-not-found — the documented escape hatch for a root layout that
   lives under a top-level dynamic segment ([locale]): there is no single
   layout to compose a 404 from, so this bypasses the tree entirely and has
   to bring its own fonts, styles and <html>/<body>. No `params` reach it
   either, so the locale is unknown — every link falls back to the default
   locale, same as a first-time visit with no locale in the URL yet.

   Laid out per the 404 Wireframe (sheet 1a desktop / 1b mobile): a centred
   typographic pause between an intact header and footer — small line, display
   numeral, one calm sentence, one action. No card and no illustration.

   The wireframe draws the button as the generic greybox primary; here it is
   clay, which is what "primary" means in this system, and it is the only
   clay on the page (principle 02). */

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
  title: "Page not found · Nihonova Books",
  description: "The page you are looking for does not exist.",
};

export default function GlobalNotFound() {
  const home = `/${defaultLocale}`;

  /* The nav is the app's client FloatingNav, which reads the cart from the
     store — there is no provider out here, so the header narrows to the
     wordmark. It still leads home, which is the page's whole purpose. */
  return (
    <html
      lang={defaultLocale}
      className={`${lora.variable} ${publicSans.variable} h-full antialiased`}
    >
      <body className="bg-page flex min-h-full flex-col">
        <header className="border-rule border-b">
          <div className="shell flex h-16 items-center">
            <Link href={home} className="text-ink">
              <Wordmark />
            </Link>
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center">
          <div className="shell flex flex-col items-center py-24 text-center lg:py-section">
            {/* The words carry the heading; the numeral is decoration a screen
                reader gains nothing from hearing (principle 03). */}
            <h1 className="eyebrow">Page not found</h1>

            <p
              aria-hidden="true"
              className="text-72 lg:text-120 text-ink mt-5 font-serif leading-[0.95] tracking-[-0.02em]"
            >
              404
            </p>

            <p className="max-w-measure-lede text-body text-secondary mt-9">
              The page you&rsquo;re looking for doesn&rsquo;t exist.
            </p>

            {/* The only action on the page. Full width at mobile, where the
                wireframe gives it the 48px tap target. */}
            <div className="mt-10 w-full max-w-xs sm:w-auto">
              <LinkButton href={home} size="lg" block className="sm:w-auto">
                Back to home
              </LinkButton>
            </div>
          </div>
        </main>

        <SiteFooter
          blurb="A small catalogue of books, chosen by hand and posted from Bristol."
          columns={footerColumns.map((column) => ({
            ...column,
            /* Every path in the table is locale-relative; out here the default
               locale is all we know. */
            links: localizeLinks(column.links, defaultLocale),
          }))}
          note={`© ${new Date().getFullYear()} Nihonova Books`}
        />
      </body>
    </html>
  );
}
