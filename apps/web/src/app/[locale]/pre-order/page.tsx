import type { Metadata } from "next";

import { AppNav, PageShell, Shell, SiteFooter } from "@/components/layout";
import { EmptyState } from "@/components/domain";
import { PreOrderCartView } from "@/components/pre-order/pre-order-cart-view";
import { getTranslation } from "@/i18n/server";
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
  title: "Pre-order · Marginalia",
};

export default async function PreOrderPage({ params }: PageProps<"/[locale]/pre-order">) {
  const { locale } = (await params) as { locale: Locale };
  const { t } = await getTranslation(locale);
  const path = routes(locale);

  const book = await getActivePreOrderBook();

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
          note={`© ${new Date().getFullYear()} Marginalia Books`}
        />
      }
    >
      {book ? (
        <PreOrderCartView locale={locale} book={book} />
      ) : (
        <Shell className="py-14 lg:py-20">
          <EmptyState
            eyebrow="Pre-order"
            title="Pre-orders are coming soon"
            description="We're not taking pre-orders yet — check back shortly."
          />
        </Shell>
      )}
    </PageShell>
  );
}
