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

/* The one title this page is currently collecting signups for. Every waitlist
   entry today is for it, so the form asks nobody to choose — see waitedOnBook()
   and the `fixedBook` prop.

   Matched by slug rather than id or title: a UUID here would say nothing about
   which book it is, and titles get re-edited (this one carries a typo the
   catalog has already shipped). When several titles are worth waiting on again,
   this constant and waitedOnBook() go away and the picker comes back — the form
   still supports it. */
const WAITED_ON_SLUG = "kanji-redical-guide-book";

/**
 * The single title the form signs people up for, or null to fall back.
 *
 * Read from the public catalog rather than hardcoded alongside the slug, so the
 * title shown and snapshotted is whatever the catalog currently says — and so a
 * book that has been restocked or removed stops being offered on its own.
 *
 * Null is a real state, not an error: the form then writes a general-list
 * signup, which is what the shop-wide pause always meant.
 */
async function waitedOnBook(): Promise<{ id: string; title: string } | null> {
  try {
    const list = await listBooks({ q: "", genres: [], sort: "recent", page: 1 }, { pageSize: 100 });

    const book = list.items.find(
      (item) =>
        item.slug === WAITED_ON_SLUG &&
        (item.stockQuantity === 0 || item.availability !== "in_stock"),
    );

    return book ? { id: book.id, title: book.title } : null;
  } catch {
    /* The API being down must not take the page with it. Without a book the
       form still writes a general-list signup, which is strictly better than
       an error page on the one screen whose entire job is catching people the
       shop has already disappointed once. */
    return null;
  }
}

export default async function NotifyPage({ params }: PageProps<"/[locale]/notify">) {
  const { locale } = (await params) as { locale: Locale };
  const { t } = await getTranslation(locale);
  const path = routes(locale);
  const book = await waitedOnBook();

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
          <NotifyWaitlistForm locale={locale} fixedBook={book} />
        </div>
      </Shell>
    </PageShell>
  );
}
