import type { Metadata } from "next";

import { AppNav, PageHeader, PageShell, Shell, SiteFooter } from "@/components/layout";
import { LinkButton } from "@/components/ui";
import { getTranslation } from "@/i18n/server";
import type { Locale } from "@/i18n/settings";
import { footerColumns } from "@/lib/books";
import { localizeLinks, routes } from "@/lib/routes";
import { localeAlternates } from "@/lib/site";

const email = "info@nihonovaacademy.com";
const messengerHref = "https://m.me/nihonovaacademy";
const facebookHref = "https://www.facebook.com/nihonovaacademy/";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/contact">): Promise<Metadata> {
  const { locale } = (await params) as { locale: Locale };
  const { t } = await getTranslation(locale);

  return {
    title: t("contact.title"),
    alternates: localeAlternates(locale, "/contact"),
  };
}

export default async function ContactPage({ params }: PageProps<"/[locale]/contact">) {
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
          eyebrow={t("contact.eyebrow")}
          title={t("contact.title")}
          description={t("contact.intro")}
          size="md"
        />

        <dl className="divide-rule border-rule mt-12 max-w-measure-lede divide-y border-t">
          <div className="flex flex-col gap-1 py-6">
            <dt className="eyebrow">{t("contact.address.label")}</dt>
            <dd className="text-body text-ink">{t("contact.address.value")}</dd>
          </div>

          <div className="flex flex-col gap-1 py-6">
            <dt className="eyebrow">{t("contact.email.label")}</dt>
            <dd>
              <a href={`mailto:${email}`} className="text-body text-ink hover:text-secondary">
                {email}
              </a>
            </dd>
          </div>

          <div className="flex flex-col gap-3 py-6">
            <dt className="eyebrow">{t("contact.messenger.label")}</dt>
            <dd>
              <LinkButton href={messengerHref} target="_blank" rel="noopener noreferrer">
                {t("contact.messenger.action")}
              </LinkButton>
            </dd>
          </div>
        </dl>

        <a
          href={facebookHref}
          target="_blank"
          rel="noopener noreferrer"
          className="text-caption text-secondary hover:text-ink mt-6 [display:inline-block]"
        >
          facebook.com/nihonovaacademy
        </a>
      </Shell>
    </PageShell>
  );
}
