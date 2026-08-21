import type { Metadata } from "next";

import { AppNav, PageShell, SiteFooter } from "@/components/layout";
import { getTranslation } from "@/i18n/server";
import type { Locale } from "@/i18n/settings";
import { footerColumns } from "@/lib/books";
import { localizeLinks, routes } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Pre-order · Marginalia",
};

export default async function PreOrderPage({ params }: PageProps<"/[locale]/pre-order">) {
  const { locale } = (await params) as { locale: Locale };
  const { t } = await getTranslation(locale);
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
          note={`© ${new Date().getFullYear()} Marginalia Books`}
        />
      }
    >
      <div className="mx-auto max-w-shell px-4 py-24 text-center sm:px-page-tablet">
        <h1 className="font-serif text-3xl">Pre-orders are coming soon</h1>
        <p className="text-secondary mt-3">
          We&apos;re not taking pre-orders yet — check back shortly.
        </p>
      </div>
    </PageShell>
  );
}
