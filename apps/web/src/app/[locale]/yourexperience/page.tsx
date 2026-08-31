import type { Metadata } from "next";

import { ReviewForm } from "@/components/domain";
import { AppNav, PageShell, SiteFooter } from "@/components/layout";
import { getTranslation } from "@/i18n/server";
import type { Locale } from "@/i18n/settings";
import { footerColumns } from "@/lib/books";
import { localizeLinks, routes } from "@/lib/routes";
import { localeAlternates } from "@/lib/site";

/* --------------------------------------------------------------------------
   Where a customer writes about the service.

   Sits at /yourexperience rather than under /reviews so the listing of
   approved testimonials can take /reviews later without this page having to
   move — a URL that goes out on packing slips and follow-up messages is not a
   thing to rename. It also reads as an invitation rather than a filing
   cabinet, which is the difference between a link people follow and one they
   scroll past.

   One narrow column, per the wireframe, and no <Shell>: this page has a
   single object on it, and the catalogue's wide grid measure would only put
   the writing box adrift in the middle of the screen. Left-aligned rather
   than centred — the eye has a fixed left edge to return to, which centred
   text does not give it once the copy runs past one line.

   Nothing here reads the API: the page is static and the form is the only
   client component on it, so an API outage costs a submission rather than the
   whole screen.
   -------------------------------------------------------------------------- */

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/yourexperience">): Promise<Metadata> {
  const { locale } = (await params) as { locale: Locale };
  const { t } = await getTranslation(locale);

  return {
    title: t("reviews.title"),
    description: t("reviews.intro"),
    alternates: localeAlternates(locale, "/yourexperience"),
  };
}

export default async function WriteReviewPage({ params }: PageProps<"/[locale]/yourexperience">) {
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
      <div className="px-gutter mx-auto w-full max-w-155 py-16 lg:py-20">
        <h1 className="text-32 lg:text-40 text-ink text-center font-serif leading-tight text-balance">
          {t("reviews.title")}
        </h1>

        {/* Thanks them, then names the span the review can cover — ordering
            through to the book arriving — so nobody has to guess what counts
            as useful. Everything the page has to say about how a review is
            handled is said down at the control it applies to, not here. */}
        <p className="text-body mt-5 text-center text-pretty">{t("reviews.intro")}</p>

        <ReviewForm className="mt-10" catalogHref={path.catalog} ordersHref={path.orders} />
      </div>
    </PageShell>
  );
}
