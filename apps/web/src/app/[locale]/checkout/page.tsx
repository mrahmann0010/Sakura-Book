import type { Metadata } from "next";

import { CheckoutView } from "@/components/checkout/checkout-view";
import { AppNav, PageShell } from "@/components/layout";
import type { Locale } from "@/i18n/settings";
import { routes } from "@/lib/routes";

/* Checkout — Cart & Checkout Wireframe (1d/1e).

   A minimal header and no footer: the wireframe is explicit that navigation
   goes away during checkout, so the only ways out are the wordmark, the recap's
   "Edit cart" link and the submit button. That is the difference in shell
   between this page and the cart, and it follows from their different jobs. */

export const metadata: Metadata = {
  title: "Checkout · Nihonova Books",
  /* Nothing here should ever be indexed or prefetched into a crawler. */
  robots: { index: false, follow: false },
};

export default async function CheckoutPage({ params }: PageProps<"/[locale]/checkout">) {
  const { locale } = (await params) as { locale: Locale };
  const path = routes(locale);

  return (
    <PageShell header={<AppNav brandHref={path.home} />}>
      <CheckoutView locale={locale} />
    </PageShell>
  );
}
