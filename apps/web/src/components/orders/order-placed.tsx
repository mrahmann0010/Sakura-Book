"use client";

import { useTranslation } from "react-i18next";
import type { Order } from "@sakura/contracts";

import { Shell } from "@/components/layout";
import { LinkButton } from "@/components/ui";
import type { Locale } from "@/i18n/settings";
import { routes } from "@/lib/routes";

import { OrderReceipt } from "./order-receipt";

/* --------------------------------------------------------------------------
   The screen a shopper lands on the moment an order exists: the thank-you,
   the full receipt, and the two ways onward.

   One component for both checkouts. The ordinary cart checkout and the
   waitlist-invite checkout reach this point by different routes and with
   different baskets, but what they have at the end is the same thing — the
   `Order` the API just returned — and a shopper who ordered through an invite
   link has no less reason to see what they bought. Keeping this in one place
   is what stops the two screens drifting apart again: the invite one had been
   sitting on a bare order-ID card for as long as the checkout one had a
   receipt, purely because nobody updated it twice.

   `email` is the address the confirmation was sent to, which is the form's
   value rather than anything on the order.
   -------------------------------------------------------------------------- */

export function OrderPlaced({
  order,
  email,
  locale,
}: {
  order: Order;
  email: string;
  locale: Locale;
}) {
  const { t } = useTranslation();
  const path = routes(locale);

  return (
    <Shell className="py-14 lg:py-20">
      <div className="max-w-measure">
        <p className="eyebrow">{t("checkout.placed.eyebrow")}</p>
        <h1 className="text-36 lg:text-44 text-ink mt-4 font-serif leading-tight">
          {t("checkout.placed.title")}
        </h1>
        <p className="text-body mt-5">{t("checkout.placed.description", { email })}</p>

        <div className="mt-8">
          <OrderReceipt order={order} locale={locale} />
        </div>

        {/* mt-3, not the mt-8 that separated these from a lone ID card: the
            receipt ends in its own full-width download button, and two
            button rows want the gap between buttons, not between sections. */}
        <div className="mt-3 flex flex-wrap gap-3">
          <LinkButton href={path.catalog}>{t("checkout.placed.action")}</LinkButton>
          <LinkButton href={path.order(order.orderNumber)} variant="secondary">
            {t("checkout.placed.track")}
          </LinkButton>
        </div>
      </div>
    </Shell>
  );
}
