import type { Metadata } from "next";

import { AppNav, PageHeader, PageShell, Section, Shell, SiteFooter } from "@/components/layout";
import { getTranslation } from "@/i18n/server";
import type { Locale } from "@/i18n/settings";
import { footerColumns } from "@/lib/books";
import { localizeLinks, routes } from "@/lib/routes";
import { localeAlternates } from "@/lib/site";

const sectionKeys = [
  "orders",
  "payment",
  "delivery",
  "refunds",
  "conduct",
  "liability",
  "changes",
] as const;

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/terms">): Promise<Metadata> {
  const { locale } = (await params) as { locale: Locale };
  const { t } = await getTranslation(locale);

  return {
    title: t("terms.title"),
    alternates: localeAlternates(locale, "/terms"),
  };
}

export default async function TermsPage({ params }: PageProps<"/[locale]/terms">) {
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
      <Shell className="py-14 lg:py-20">
        <PageHeader
          eyebrow={t("terms.eyebrow")}
          title={t("terms.title")}
          description={t("terms.intro")}
          size="md"
        />

        <div className="mt-12 flex flex-col gap-10">
          {sectionKeys.map((key) => {
            const body = t(`terms.sections.${key}.body`, { returnObjects: true }) as
              | string[]
              | string;
            const paragraphs = Array.isArray(body) ? body : [body];

            return (
              <div key={key}>
                <h2 className="text-20 text-ink lg:text-22 font-serif leading-tight">
                  {t(`terms.sections.${key}.title`)}
                </h2>
                <div className="mt-3 flex flex-col gap-3">
                  {paragraphs.map((paragraph, index) => (
                    <p key={index} className="text-body max-w-measure-lede text-secondary">
                      {paragraph}
                    </p>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <Section tint className="mt-12">
          <p className="text-caption text-secondary max-w-measure-lede">{t("terms.note")}</p>
        </Section>
      </Shell>
    </PageShell>
  );
}
