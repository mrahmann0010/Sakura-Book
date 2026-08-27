import type { Metadata } from "next";

import { AppNav, PageShell, Shell, SiteFooter } from "@/components/layout";
import { NotifyWaitlistForm } from "@/components/domain";
import { Badge } from "@/components/ui";
import { getTranslation } from "@/i18n/server";
import type { Locale } from "@/i18n/settings";
import { listBooks } from "@/lib/api/catalog";
import { footerColumns } from "@/lib/books";
import { localizeLinks, routes } from "@/lib/routes";
import { localeAlternates } from "@/lib/site";

/* The date pre-orders reopen. One place to move when the estimate changes —
   the page reads it, so does the badge copy in i18n via interpolation. */
const REOPEN_DATE = "September 15, 2026";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/notify">): Promise<Metadata> {
  const { locale } = (await params) as { locale: Locale };
  const { t } = await getTranslation(locale);

  return {
    title: t("notify.title"),
    alternates: localeAlternates(locale, "/notify"),
  };
}

/**
 * The titles offered in the picker: everything a customer cannot buy today.
 *
 * Read from the public catalog rather than a curated list, so a book selling
 * out starts appearing here and a restocked one stops, with nothing to
 * maintain. `stockQuantity === 0` is the honest test — `availability` is an
 * editorial label ("coming soon") that can disagree with the shelf, and it is
 * the shelf that decides whether there is anything to wait for.
 *
 * An empty result is a real state, not an error: it means everything is in
 * stock, and the form falls back to the general list on its own.
 */
async function waitableBooks(): Promise<{ id: string; title: string }[]> {
  try {
    const list = await listBooks({ q: "", genres: [], sort: "recent", page: 1 }, { pageSize: 100 });

    return list.items
      .filter((book) => book.stockQuantity === 0 || book.availability !== "in_stock")
      .map((book) => ({ id: book.id, title: book.title }));
  } catch {
    /* The API being down must not take the page with it. Without a picker the
       form still writes a general-list signup, which is strictly better than
       an error page on the one screen whose entire job is catching people the
       shop has already disappointed once. */
    return [];
  }
}

export default async function NotifyPage({ params }: PageProps<"/[locale]/notify">) {
  const { locale } = (await params) as { locale: Locale };
  const { t } = await getTranslation(locale);
  const path = routes(locale);
  const books = await waitableBooks();

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
      <Shell className="py-14 lg:py-20">
        <div className="mx-auto max-w-measure-lede text-center">
          <Badge tone="accent" className="mx-auto">
            {t("notify.badge")}
          </Badge>

          <h1 className="text-36 lg:text-44 text-ink mt-5 font-serif leading-tight">
            {t("notify.title")}
          </h1>

          <p className="text-body text-secondary eyebrow mt-3 tracking-normal normal-case">
            {t("notify.reopenDate", { date: REOPEN_DATE })}
          </p>

          <p className="text-body mt-5">{t("notify.intro")}</p>
        </div>

        <div className="mx-auto mt-10 max-w-measure-lede">
          <NotifyWaitlistForm locale={locale} books={books} />
        </div>
      </Shell>
    </PageShell>
  );
}
