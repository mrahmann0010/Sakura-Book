import type { Metadata } from "next";

import { OrderDetailView } from "@/components/orders/order-detail-view";
import { AppNav, PageShell, Shell, SiteFooter } from "@/components/layout";
import { LinkButton } from "@/components/ui";
import { getTranslation } from "@/i18n/server";
import type { Locale } from "@/i18n/settings";
import { footerColumns } from "@/lib/books";
import { localizeLinks, routes } from "@/lib/routes";

/* The redirect target from TrackOrderView (single match, or one picked from
   several) and the direct destination once a shopper bookmarks/shares it.
   Order number alone is a sufficient lookup key — see the comment on
   orderLookupRequestSchema — so this needs none of the tracking form's
   credentials to render.

   The chrome is server-rendered and the order itself is not: the lookup runs
   in the browser, from OrderDetailView, so that the API's per-IP rate limit
   sees the visitor rather than this server. See that component for why that
   distinction had teeth. */

export const metadata: Metadata = {
  title: "Order details · Nihonova Books",
  /* A personal view of one shopper's order — nothing here belongs in an index. */
  robots: { index: false, follow: true },
};

export default async function OrderDetailPage({
  params,
}: PageProps<"/[locale]/orders/[orderNumber]">) {
  const { locale, orderNumber } = (await params) as { locale: Locale; orderNumber: string };
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
      <Shell className="max-w-measure py-14 lg:py-20">
        <LinkButton href={path.orders} variant="secondary">
          ← Track another order
        </LinkButton>
        <OrderDetailView orderNumber={orderNumber} />
      </Shell>
    </PageShell>
  );
}

function localizeFooter(locale: Locale) {
  return footerColumns.map((column) => ({
    ...column,
    links: localizeLinks(column.links, locale),
  }));
}
