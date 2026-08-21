import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppNav, PageShell, SiteFooter } from "@/components/layout";
import { PreOrderCheckoutView } from "@/components/pre-order/pre-order-checkout-view";
import type { Locale } from "@/i18n/settings";
import { getActivePreOrderBook } from "@/lib/api/pre-order";
import { footerColumns } from "@/lib/books";
import { localizeLinks, routes } from "@/lib/routes";

/**
 * Rendered per request, not frozen into the build.
 *
 * This page's content is live shop state — whether a pre-order is running at
 * all — fetched from an API that deploys separately from this frontend. Next
 * prerenders it at build time by default, which quietly made a successful
 * frontend build depend on the API being up and current at that moment. It
 * is not a theoretical coupling: the build that shipped this feature failed
 * on exactly that, because Vercel built from main while the API was still
 * mid-deploy and had never heard of /pre-order-books/active.
 *
 * Two services that release independently must not be able to fail each
 * other's builds. Nothing is lost by moving the fetch to request time: the
 * API sets its own Cache-Control, and an outage now surfaces as an error
 * rather than as a build that cannot be made to pass until the other side
 * recovers.
 */
export const dynamic = "force-dynamic";

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
