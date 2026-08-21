import type { Metadata } from "next";

import { AppNav, PageShell, SiteFooter } from "@/components/layout";
import { TrackOrderView } from "@/components/orders/track-order-view";
import { getTranslation } from "@/i18n/server";
import type { Locale } from "@/i18n/settings";
import { footerColumns } from "@/lib/books";
import { localizeLinks, routes } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Track your order · Nihonova Books",
  /* A personal view of one shopper's state — nothing here belongs in an index. */
  robots: { index: false, follow: true },
};

export default async function TrackOrderPage({ params }: PageProps<"/[locale]/orders">) {
  const { locale } = (await params) as { locale: Locale };
  const { t } = await getTranslation(locale);
  const path = routes(locale);

  return (
    <PageShell
      header={<AppNav brandHref={path.home} />}
      footer={
        <SiteFooter
          blurb={t("home.hero.subhead")}
          columns={localizeFooter(locale)}
          note={`© ${new Date().getFullYear()} Nihonova Books`}
        />
      }
    >
      <TrackOrderView />
    </PageShell>
  );
}

function localizeFooter(locale: Locale) {
  return footerColumns.map((column) => ({
    ...column,
    links: localizeLinks(column.links, locale),
  }));
}
