import { headers } from "next/headers";

import { EmptyState } from "@/components/domain";
import { AppNav, PageShell, Shell } from "@/components/layout";
import { LinkButton } from "@/components/ui";
import { getTranslation } from "@/i18n/server";
import { defaultLocale, isLocale } from "@/i18n/settings";
import { LOCALE_HEADER } from "@/proxy";
import { routes } from "@/lib/routes";

/* A wrong, expired, or already-used invite token — the API can't and
   shouldn't distinguish those (see WaitlistInviteInvalidError), so this is
   the one state for all three. Same server-component-reading-the-locale-off
   proxy.ts convention as orders/[orderNumber]/not-found.tsx. */

export default async function WaitlistInviteNotFound() {
  const header = (await headers()).get(LOCALE_HEADER);
  const locale = header && isLocale(header) ? header : defaultLocale;
  const { t } = await getTranslation(locale);
  const path = routes(locale);

  return (
    <PageShell header={<AppNav />}>
      <Shell className="py-20">
        <EmptyState
          eyebrow={t("waitlistInvite.expired.eyebrow")}
          title={t("waitlistInvite.expired.title")}
          description={t("waitlistInvite.expired.description")}
          action={
            <LinkButton href={path.contact} variant="secondary">
              {t("waitlistInvite.expired.action")}
            </LinkButton>
          }
        />
      </Shell>
    </PageShell>
  );
}
