import { headers } from "next/headers";

import { EmptyState } from "@/components/domain";
import { AppNav, PageShell, Shell } from "@/components/layout";
import { LinkButton } from "@/components/ui";
import { getTranslation } from "@/i18n/server";
import { defaultLocale, isLocale } from "@/i18n/settings";
import { LOCALE_HEADER } from "@/proxy";
import { routes } from "@/lib/routes";

/* A slug that is not on the shelf — a stale bookmark, a delisted title, a
   typo. Reached by `notFound()` in the page, which is also what injects the
   `noindex` meta so a dead book URL does not stay in an index.

   A server component, and deliberately so. This was first written as a client
   component reading `useParams` for the locale, because the not-found file
   convention takes no props. It rendered nothing at all: a client component
   used as a not-found boundary is not server-rendered, so the 404 was a blank
   page until hydration and permanently blank to anything that does not run
   JavaScript. The locale now arrives on a request header set in proxy.ts,
   which is the only way into this file. */

export default async function BookNotFound() {
  const header = (await headers()).get(LOCALE_HEADER);
  const locale = header && isLocale(header) ? header : defaultLocale;
  const { t } = await getTranslation(locale);

  return (
    <PageShell header={<AppNav />}>
      <Shell className="py-20">
        <EmptyState
          eyebrow={t("book.notFound.eyebrow")}
          title={t("book.notFound.title")}
          description={t("book.notFound.description")}
          action={
            <LinkButton href={routes(locale).catalog} variant="secondary">
              {t("book.notFound.action")}
            </LinkButton>
          }
        />
      </Shell>
    </PageShell>
  );
}
