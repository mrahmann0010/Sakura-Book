import type { Metadata } from "next";

import { CartView } from "@/components/cart/cart-view";
import { AppNav, PageShell, SiteFooter } from "@/components/layout";
import { getTranslation } from "@/i18n/server";
import type { Locale } from "@/i18n/settings";
import { footerColumns } from "@/lib/books";
import { localizeLinks, routes } from "@/lib/routes";

/* Cart — Cart & Checkout Wireframe (1a/1b/1c).

   The shell, header and footer are server-rendered; only the part that reads
   the browser's cart is a client component. The page keeps its navigation:
   changing your mind about what to buy means going back to the shelves, which
   is the opposite of checkout, where the nav goes away. */

export const metadata: Metadata = {
  title: "Your cart · Marginalia",
};

export default async function CartPage({ params }: PageProps<"/[locale]/cart">) {
  const { locale } = (await params) as { locale: Locale };
  const { t } = await getTranslation(locale);
  const path = routes(locale);

  return (
    <PageShell
      header={
<AppNav brandHref={path.home} />
      }
      footer={
        <SiteFooter
          blurb={t("home.hero.subhead")}
          columns={localizeFooter(locale)}
          note={`© ${new Date().getFullYear()} Marginalia Books`}
        />
      }
    >
      <CartView locale={locale} />
    </PageShell>
  );
}

function localizeFooter(locale: Locale) {
  return footerColumns.map((column) => ({
    ...column,
    links: localizeLinks(column.links, locale),
  }));
}
