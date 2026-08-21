import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppNav, PageShell, SiteFooter } from "@/components/layout";
import { PreOrderCheckoutView } from "@/components/pre-order/pre-order-checkout-view";
import type { Locale } from "@/i18n/settings";
import { getActivePreOrderBook } from "@/lib/api/pre-order";
import { footerColumns } from "@/lib/books";
import { localizeLinks, routes } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Pre-order checkout · Marginalia",
};

export default async function PreOrderCheckoutPage({
  params,
}: PageProps<"/[locale]/pre-order/checkout">) {
  const { locale } = (await params) as { locale: Locale };
  const path = routes(locale);

  const book = await getActivePreOrderBook();

  // No pre-order running: there is nothing to check out, so this route is
  // simply not reachable — same as a book detail page for a delisted slug.
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
          note={`© ${new Date().getFullYear()} Marginalia Books`}
        />
      }
    >
      <PreOrderCheckoutView locale={locale} book={book} />
    </PageShell>
  );
}
