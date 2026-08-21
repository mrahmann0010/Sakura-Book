"use client";

import { AppNav, PageShell, SiteFooter } from "@/components/layout";
import { useTranslation } from "react-i18next";

import type { Locale } from "@/i18n/settings";
import { footerColumns } from "@/lib/books";
import { localizeLinks, routes } from "@/lib/routes";

import { CartView } from "./cart-view";

/* --------------------------------------------------------------------------
   The cart page, client-side from the shell down.

   Every other route renders its chrome on the server and mounts a client
   island for the interactive part. The cart does not, because on this page
   there is no meaningful non-interactive part: the header count, the rows,
   the totals, the undo window and the checkout button all read the same
   browser-owned cart, and a server render can only ever produce the empty
   version of it. Splitting the page in two bought a server-rendered footer
   and cost a seam.

   This still server-renders — a client component is prerendered to HTML like
   any other — so the first paint is the full page in the right language, with
   `next/link` navigation intact. What changes is that the whole tree is one
   hydration unit that can react to the cart, rather than static chrome with a
   hole in it.

   Metadata is the one thing that cannot come along: Next.js only reads
   `metadata` from a server file, so `app/[locale]/cart/page.tsx` keeps the
   title and mounts this.
   -------------------------------------------------------------------------- */

export function CartPage({ locale }: { locale: Locale }) {
  const { t } = useTranslation();
  const path = routes(locale);

  return (
    <PageShell
      header={<AppNav brandHref={path.home} />}
      footer={
        <SiteFooter
          blurb={t("home.hero.subhead")}
          columns={footerColumns.map((column) => ({
            ...column,
            links: localizeLinks(column.links, locale),
          }))}
          note={`© ${new Date().getFullYear()} Nihonova Books`}
        />
      }
    >
      <CartView locale={locale} />
    </PageShell>
  );
}
