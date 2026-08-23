import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { OrderDetailCard } from "@/components/orders/order-detail-card";
import { AppNav, PageShell, Shell, SiteFooter } from "@/components/layout";
import { LinkButton } from "@/components/ui";
import { getTranslation } from "@/i18n/server";
import type { Locale } from "@/i18n/settings";
import { lookupOrder } from "@/lib/api/orders";
import { footerColumns } from "@/lib/books";
import { localizeLinks, routes } from "@/lib/routes";

/* The redirect target from TrackOrderView (single match, or one picked from
   several) and the direct destination once a shopper bookmarks/shares it.
   Order number alone is a sufficient lookup key — see the comment on
   orderLookupRequestSchema — so this stays a plain server component rather
   than needing the tracking form's credentials. */

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

  const orders = await lookupOrder({ orderNumber });
  const order = orders[0];
  if (!order) notFound();

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
        <OrderDetailCard order={order} />
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
