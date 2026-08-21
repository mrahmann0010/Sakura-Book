import type { Metadata } from "next";

import { AppNav, PageShell, Shell, SiteFooter } from "@/components/layout";
import { EmptyState } from "@/components/domain";
import { PreOrderCartView } from "@/components/pre-order/pre-order-cart-view";
import { getTranslation } from "@/i18n/server";
import type { Locale } from "@/i18n/settings";
import { getActivePreOrderBook } from "@/lib/api/pre-order";
import { footerColumns } from "@/lib/books";
import { localizeLinks, routes } from "@/lib/routes";

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
