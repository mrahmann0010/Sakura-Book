import type { Metadata } from "next";

import { CheckoutView } from "@/components/checkout/checkout-view";
import { AppNav, PageShell } from "@/components/layout";
import type { Locale } from "@/i18n/settings";
import { offerableBooks } from "@/lib/also-available";
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

/* How many titles to fetch for the "same parcel" strip. The strip shows three;
   the extras are headroom, because the cart is browser state the server cannot
   see, and a shopper whose cart already holds the first two would otherwise be
   offered a list with holes in it. */
const ALSO_AVAILABLE_FETCH = 8;

export default async function CheckoutPage({ params }: PageProps<"/[locale]/checkout">) {
  const { locale } = (await params) as { locale: Locale };
  const path = routes(locale);

  /* Nothing is excluded here: what the order already holds lives in Redux, so
     CheckoutView does that filtering once it has hydrated. */
  const alsoAvailable = await offerableBooks([], ALSO_AVAILABLE_FETCH);

  return (
    <PageShell header={<AppNav brandHref={path.home} />}>
      <CheckoutView locale={locale} alsoAvailable={alsoAvailable} />
    </PageShell>
  );
}
