import { notFound } from "next/navigation";

/* Pre-order stream disabled — single normal flow for all books.
   Everything below is commented out rather than deleted, in case the
   pre-order stream comes back.

import type { Metadata } from "next";
import { Suspense } from "react";

import { AppNav, PageShell, Shell, SiteFooter } from "@/components/layout";
import { EmptyState } from "@/components/domain";
import { Skeleton } from "@/components/ui";
import { PreOrderCartView } from "@/components/pre-order/pre-order-cart-view";
import { getTranslation } from "@/i18n/server";
import type { Locale } from "@/i18n/settings";
import { getActivePreOrderBook } from "@/lib/api/pre-order";
import { footerColumns } from "@/lib/books";
import { localizeLinks, routes } from "@/lib/routes";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pre-order · Nihonova Books",
};

async function PreOrderContent({ locale }: { locale: Locale }) {
  const book = await getActivePreOrderBook();

  return book ? (
    <PreOrderCartView locale={locale} book={book} />
  ) : (
    <Shell className="py-14 lg:py-20">
      <EmptyState
        eyebrow="Pre-order"
        title="Pre-orders are coming soon"
        description="We're not taking pre-orders yet — check back shortly."
      />
    </Shell>
  );
}

function PreOrderSkeleton() {
  return (
    <Shell className="py-14 lg:py-20">
      <Skeleton className="h-11 w-56" />
      <Skeleton className="mt-3 h-4 w-80 max-w-full" />

      <div className="mt-10 grid grid-cols-1 gap-8 sm:grid-cols-[200px_1fr]">
        <Skeleton className="aspect-2/3 w-full rounded-md" />

        <div>
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="mt-2 h-4 w-1/3" index={1} />
          <Skeleton className="mt-4 h-3.5 w-full" index={2} />
          <Skeleton className="mt-2 h-3.5 w-4/5" index={3} />

          <Skeleton className="mt-6 h-5 w-24" index={4} />
          <Skeleton className="mt-4 h-10 w-32 rounded-full" index={5} />
          <Skeleton className="mt-8 h-11 w-full max-w-56 rounded-full" index={6} />
        </div>
      </div>
    </Shell>
  );
}

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
          note={`© ${new Date().getFullYear()} Nihonova Books`}
        />
      }
    >
      <Suspense fallback={<PreOrderSkeleton />}>
        <PreOrderContent locale={locale} />
      </Suspense>
    </PageShell>
  );
}

*/

export default function PreOrderPage(): never {
  notFound();
}
