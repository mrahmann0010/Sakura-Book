import type { Metadata } from "next";

import { AppNav, PageHeader, PageShell, Section, Shell, SiteFooter } from "@/components/layout";
import { getTranslation } from "@/i18n/server";
import type { Locale } from "@/i18n/settings";
import { footerColumns } from "@/lib/books";
import { localizeLinks, routes } from "@/lib/routes";
import { localeAlternates } from "@/lib/site";

const sectionKeys = [
  "cancellation",
  "afterDelivery",
  "method",
  "processingTime",
  "deliveryCharge",
  "specialCases",
] as const;

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/refund-policy">): Promise<Metadata> {
  const { locale } = (await params) as { locale: Locale };
  const { t } = await getTranslation(locale);

  return {
    title: t("refundPolicy.title"),
    alternates: localeAlternates(locale, "/refund-policy"),
  };
}

export default async function RefundPolicyPage({
  params,
}: PageProps<"/[locale]/refund-policy">) {
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
          eyebrow={t("refundPolicy.eyebrow")}
          title={t("refundPolicy.title")}
          description={t("refundPolicy.intro")}
          size="md"
        />

        <div className="mt-12 lg:grid lg:grid-cols-[1fr_240px] lg:items-start lg:gap-16">
          <div className="flex flex-col gap-10 lg:max-w-[68ch]">
            {sectionKeys.map((key) => (
              <div key={key} id={key} className="scroll-mt-24">
                <h2 className="text-20 text-ink lg:text-22 font-serif leading-tight">
                  {t(`refundPolicy.sections.${key}.title`)}
                </h2>
                <div className="mt-3 flex flex-col gap-3">
                  {(
                    t(`refundPolicy.sections.${key}.body`, { returnObjects: true }) as string[]
                  ).map((paragraph, index) => (
                    <p key={index} className="text-body text-secondary">
                      {paragraph}
                    </p>
                  ))}
                </div>
              </div>
            ))}

            <Section tint>
              <p className="text-caption text-secondary">{t("refundPolicy.note")}</p>
            </Section>
          </div>

          <nav
            aria-label={t("refundPolicy.title")}
            className="border-rule mt-12 hidden border-t pt-6 lg:sticky lg:top-24 lg:mt-0 lg:block lg:border-t-0 lg:pt-0"
          >
            <p className="eyebrow">{t("refundPolicy.onThisPage")}</p>
            <ul className="mt-4 flex flex-col gap-3">
              {sectionKeys.map((key) => (
                <li key={key}>
                  <a
                    href={`#${key}`}
                    className="text-13 text-secondary hover:text-ink block leading-snug"
                  >
                    {t(`refundPolicy.sections.${key}.title`)}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </Shell>
    </PageShell>
  );
}
