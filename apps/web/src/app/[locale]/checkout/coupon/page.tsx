import type { Metadata } from "next";

import { CheckoutView } from "@/components/checkout/checkout-view";
import { AppNav, PageShell } from "@/components/layout";
import type { Locale } from "@/i18n/settings";
import { routes } from "@/lib/routes";

/* TEMPORARY — the coupon link. Not a second checkout: it renders the one
   checkout component with `allowCoupon` on, which adds two things — the
   coupon box, and a book picker in a sheet on this page, so a customer who
   opens the link with an empty cart chooses books without ever leaving it.

   Shared by direct link; nothing in the storefront points here, and the
   regular /checkout is unchanged. Any active code works.

   To retire it: delete this folder, book-picker.tsx and coupon-field.tsx,
   and drop `allowCoupon` from CheckoutView. */

export const metadata: Metadata = {
  title: "Checkout · Nihonova Books",
  robots: { index: false, follow: false },
};

export default async function CouponCheckoutPage({
  params,
}: PageProps<"/[locale]/checkout/coupon">) {
  const { locale } = (await params) as { locale: Locale };
  const path = routes(locale);

  return (
    <PageShell header={<AppNav brandHref={path.home} />}>
      <CheckoutView locale={locale} allowCoupon />
    </PageShell>
  );
}
