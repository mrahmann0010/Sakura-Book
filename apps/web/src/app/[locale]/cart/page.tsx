import type { Metadata } from "next";

import { CartPage } from "@/components/cart/cart-page";
import type { Locale } from "@/i18n/settings";

/* Cart — Cart & Checkout Wireframe (1a/1b/1c).

   A shim, deliberately. The page itself is a client component: everything on
   it reads the browser's cart, so there is nothing for a server render to
   decide. What has to stay here is the metadata — Next.js only reads it from
   a server file — and the awaited route params.

   The page keeps its navigation: changing your mind about what to buy means
   going back to the shelves, which is the opposite of checkout, where the nav
   goes away. */

export const metadata: Metadata = {
  title: "Your cart · Nihonova Books",
};

export default async function Page({ params }: PageProps<"/[locale]/cart">) {
  const { locale } = (await params) as { locale: Locale };

  return <CartPage locale={locale} />;
}
