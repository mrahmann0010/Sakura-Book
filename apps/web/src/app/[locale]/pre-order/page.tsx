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

/* The one part of the page that waits on the API. Isolated behind its own
   await so the shell around it — nav, footer — can paint immediately and
   stream this in once /pre-order-books/active answers, instead of the whole
   route blocking on it. */
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

/* Mirrors PreOrderCartView's cover + details layout so nothing shifts when
   the real content lands (§9). */
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
          note={`© ${new Date().getFullYear()} Marginalia Books`}
        />
      }
    >
      <Suspense fallback={<PreOrderSkeleton />}>
        <PreOrderContent locale={locale} />
      </Suspense>
    </PageShell>
  );
}
