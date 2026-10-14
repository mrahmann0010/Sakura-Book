import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppNav, PageHeader, PageShell, Shell, SiteFooter } from "@/components/layout";
import { FacebookIcon, LinkButton, MailIcon, MapPinIcon, MessengerIcon } from "@/components/ui";
import { getTranslation } from "@/i18n/server";
import type { Locale } from "@/i18n/settings";
import { footerColumns } from "@/lib/books";
import { localizeLinks, routes } from "@/lib/routes";
import { localeAlternates } from "@/lib/site";

const email = "contact@nihonovaacademy.com";
const messengerHref = "https://m.me/nihonovaacademy";
const facebookHref = "https://www.facebook.com/nihonovaacademy/";

/**
 * One row of the contact list: a glyph in its own tile, then the label and the
 * thing itself. The icons are decorative by the §8 rule — every row already
 * says in words what it is — so the tile is `aria-hidden` and the <dt> keeps
 * carrying the name.
 */
function ContactRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="py-6">
      <dt className="eyebrow flex items-center gap-3">
        <span
          aria-hidden
          className="border-rule bg-surface text-muted rounded-control flex size-9 shrink-0 items-center justify-center border"
        >
          {icon}
        </span>
        {label}
      </dt>
      {/* Indented to the label's own left edge — the tile plus its gap — so the
          glyph column stays a column and the values still read as a list. */}
      <dd className="mt-1 min-w-0 pl-13 wrap-break-word">{children}</dd>
    </div>
  );
}

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
          blurb={t("footer.blurb")}
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

        <dl className="divide-rule border-rule max-w-measure-lede mt-12 divide-y border-t">
          <ContactRow icon={<MapPinIcon />} label={t("contact.address.label")}>
            <span className="text-body text-ink">{t("contact.address.value")}</span>
          </ContactRow>

          <ContactRow icon={<MailIcon />} label={t("contact.email.label")}>
            <a href={`mailto:${email}`} className="text-body text-ink hover:text-secondary">
              {email}
            </a>
          </ContactRow>

          <ContactRow icon={<MessengerIcon />} label={t("contact.messenger.label")}>
            <LinkButton
              href={messengerHref}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1"
            >
              <MessengerIcon />
              {t("contact.messenger.action")}
            </LinkButton>
          </ContactRow>

          <ContactRow icon={<FacebookIcon />} label={t("contact.facebook.label")}>
            <a
              href={facebookHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-body text-ink hover:text-secondary"
            >
              facebook.com/nihonovaacademy
            </a>
          </ContactRow>
        </dl>
      </Shell>
    </PageShell>
  );
}
