import type { Metadata } from "next";

import { AppNav, PageShell, Shell, SiteFooter } from "@/components/layout";
import { NotifyWaitlistForm } from "@/components/domain";
import { Badge } from "@/components/ui";
import { getTranslation } from "@/i18n/server";
import type { Locale } from "@/i18n/settings";
import { getRestockSchedule, getWaitlistBooks } from "@/lib/api/waitlist";
import { footerColumns } from "@/lib/books";
import { localizeLinks, routes } from "@/lib/routes";
import { localeAlternates } from "@/lib/site";

/**
 * The date pre-orders reopen, formatted for the page's own language.
 *
 * The date arrives as `YYYY-MM-DD` and is formatted here rather than sent
 * ready-made, so the month reads as "September", "সেপ্টেম্বর" or "9月"
 * depending on who is looking — the old hardcoded constant was an English
 * string rendered inside a Bangla sentence.
 *
 * Parsed as UTC noon rather than `new Date("2026-09-15")` at midnight: a bare
 * ISO date is midnight UTC, which `Intl` then renders as the *previous* day
 * for any negative-offset locale. Noon has no such neighbour.
 */
function formatReopenDate(isoDate: string, locale: Locale): string | null {
  const parsed = new Date(`${isoDate}T12:00:00Z`);

  if (Number.isNaN(parsed.getTime())) return null;

  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

/**
 * When ordering reopens, or null if no date is announced.
 *
 * Same swallowed-failure policy as waitedOnBook(): the reopening line is one
 * sentence of reassurance, and losing it is not worth an error page on the
 * screen whose whole job is catching disappointed customers.
 */
async function reopenDate(): Promise<string | null> {
  try {
    const schedule = await getRestockSchedule();

    return schedule.reopenDate;
  } catch {
    return null;
  }
}

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
 * The titles staff have chosen to offer, or an empty list.
 *
 * This used to be a single slug hardcoded in this file's source, which meant
 * changing which books were on offer took a developer and a deploy. It is now
 * a per-book flag staff tick in the panel (Admin → Notify Page Books), so a
 * shop with five titles can collect names for two of them.
 *
 * Same swallowed-failure policy as reopenDate(): an empty list is a real state
 * — the form then writes general-list signups, which is what the shop-wide
 * pause always meant, and is strictly better than an error page on the one
 * screen whose entire job is catching people the shop has already disappointed.
 */
async function offeredBooks(): Promise<{ id: string; title: string }[]> {
  try {
    return await getWaitlistBooks();
  } catch {
    return [];
  }
}

export default async function NotifyPage({ params }: PageProps<"/[locale]/notify">) {
  const { locale } = (await params) as { locale: Locale };
  const { t } = await getTranslation(locale);
  const path = routes(locale);
  const [books, reopensOn] = await Promise.all([offeredBooks(), reopenDate()]);
  /* One title on offer is not a question worth asking: the form is told the
     book is decided and draws no picker, exactly as the hardcoded single-book
     version did. Two or more brings the picker back. */
  const fixedBook = books.length === 1 ? books[0] : null;
  const reopensLabel = reopensOn ? formatReopenDate(reopensOn, locale) : null;

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
        <div className="max-w-measure-lede mx-auto text-center">
          <Badge tone="accent" className="mx-auto">
            {t("notify.badge")}
          </Badge>

          <h1 className="text-36 lg:text-44 text-ink mt-5 font-serif leading-tight">
            {t("notify.title")}
          </h1>

          {/* Omitted entirely when no date is announced — a reopening line with
              a blank where the date goes reads as a bug, and a shop that has
              not committed to a date is better saying nothing than saying it
              badly. */}
          {reopensLabel ? (
            <p className="text-body text-secondary eyebrow mt-3 tracking-normal normal-case">
              {t("notify.reopenDate", { date: reopensLabel })}
            </p>
          ) : null}

          <p className="text-body mt-5">{t("notify.intro")}</p>
        </div>

        <div className="max-w-measure-lede mx-auto mt-10">
          <NotifyWaitlistForm locale={locale} books={books} fixedBook={fixedBook} />
        </div>
      </Shell>
    </PageShell>
  );
}
