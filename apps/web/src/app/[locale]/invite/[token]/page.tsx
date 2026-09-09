import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CheckoutView } from "@/components/checkout/checkout-view";
import { InviteCheckoutView } from "@/components/checkout/invite-checkout-view";
import { AppNav, PageShell } from "@/components/layout";
import type { Locale } from "@/i18n/settings";
import { ApiError } from "@/lib/api/client";
import { getWaitlistInvite } from "@/lib/api/waitlist";
import { routes } from "@/lib/routes";

/* A waitlist invite link — "your turn to order". Same bare shell as
   /checkout (no footer, nothing to navigate to but the wordmark): this is
   the same commitment step, just reached from an SMS instead of the cart.

   LOCKED invites render InviteCheckoutView, fixed to the book and quantity
   the entry was invited for. OPEN invites render the ordinary CheckoutView
   with contact fields pre-filled — the cart is the shopper's own, so there
   is nothing invite-specific about the rest of that page. */

export const metadata: Metadata = {
  title: "Complete your order · Nihonova Books",
  robots: { index: false, follow: false },
};

export default async function WaitlistInvitePage({
  params,
}: PageProps<"/[locale]/invite/[token]">) {
  const { locale, token } = (await params) as { locale: Locale; token: string };
  const path = routes(locale);

  const invite = await getWaitlistInvite(token).catch((err) => {
    if (err instanceof ApiError && err.isNotFound) notFound();
    throw err;
  });

  // LOCKED without a book is not a state issue() is meant to produce — see
  // its own comment — but this guards the checkout form rather than letting
  // a null id reach quoteCart as the string "null".
  if (invite.mode === "LOCKED" && !invite.bookId) notFound();

  const prefill = { fullName: invite.fullName, email: invite.email, phone: invite.phone };

  return (
    <PageShell header={<AppNav brandHref={path.home} />}>
      {invite.mode === "LOCKED" ? (
        <InviteCheckoutView
          locale={locale}
          token={token}
          bookId={invite.bookId!}
          quantity={invite.quantity}
          prefill={prefill}
        />
      ) : (
        <CheckoutView locale={locale} prefill={prefill} inviteToken={token} />
      )}
    </PageShell>
  );
}
