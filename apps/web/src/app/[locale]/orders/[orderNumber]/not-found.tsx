import { headers } from "next/headers";

import { EmptyState } from "@/components/domain";
import { AppNav, PageShell, Shell } from "@/components/layout";
import { LinkButton } from "@/components/ui";
import { defaultLocale, isLocale } from "@/i18n/settings";
import { LOCALE_HEADER } from "@/proxy";
import { routes } from "@/lib/routes";

/* An order number that matched nothing — a typo, or a link to an order that
   was never placed. Reached by `notFound()` in the page, which is also what
   injects the `noindex` meta so a dead order URL does not stay in an index.

   Server component reading the locale off proxy.ts's request header, same
   convention as books/[slug]/not-found.tsx — the not-found file convention
   takes no props, and a client component here would render blank until
   hydration. */

export default async function OrderNotFound() {
  const header = (await headers()).get(LOCALE_HEADER);
  const locale = header && isLocale(header) ? header : defaultLocale;

  return (
    <PageShell header={<AppNav />}>
      <Shell className="py-20">
        <EmptyState
          eyebrow="Not found"
          title="We can't find that order"
          description="Double-check the link, or look it up again with your order ID, email, or phone number."
          action={
            <LinkButton href={routes(locale).orders} variant="secondary">
              Track an order
            </LinkButton>
          }
        />
      </Shell>
    </PageShell>
  );
}
