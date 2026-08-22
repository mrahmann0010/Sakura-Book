import { notFound } from "next/navigation";

/* Pre-order stream disabled — single normal flow for all books.
   Everything below is commented out rather than deleted, in case the
   pre-order stream comes back.

import type { Metadata } from "next";

import { AppNav, PageShell, SiteFooter } from "@/components/layout";
import { PreOrderCheckoutView } from "@/components/pre-order/pre-order-checkout-view";
import type { Locale } from "@/i18n/settings";
import { getActivePreOrderBook } from "@/lib/api/pre-order";
import { footerColumns } from "@/lib/books";
import { localizeLinks, routes } from "@/lib/routes";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pre-order checkout · Nihonova Books",
};

export default async function PreOrderCheckoutPage({
  params,
}: PageProps<"/[locale]/pre-order/checkout">) {
  const { locale } = (await params) as { locale: Locale };
  const path = routes(locale);

  const book = await getActivePreOrderBook();

  if (!book) notFound();

  return (
    <PageShell
      header={<AppNav brandHref={path.home} />}
      footer={
        <SiteFooter
          blurb="Reserve your copy."
          columns={footerColumns.map((column) => ({
            ...column,
            links: localizeLinks(column.links, locale),
          }))}
          note={`© ${new Date().getFullYear()} Nihonova Books`}
        />
      }
    >
      <PreOrderCheckoutView locale={locale} book={book} />
    </PageShell>
  );
}

*/

export default function PreOrderCheckoutPage(): never {
  notFound();
}
