import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CheckoutView } from "@/components/checkout/checkout-view";
import { InviteCheckoutView } from "@/components/checkout/invite-checkout-view";
import { AppNav, PageShell } from "@/components/layout";
import type { Locale } from "@/i18n/settings";
import { offerableBooks } from "@/lib/also-available";
import { ApiError } from "@/lib/api/client";
import { getWaitlistInvite } from "@/lib/api/waitlist";
import { routes } from "@/lib/routes";

/* A waitlist invite link — "your turn to order". Same bare shell as
   /checkout (no footer, nothing to navigate to but the wordmark): this is
   the same commitment step, just reached from an SMS instead of the cart.

   LOCKED invites render InviteCheckoutView: the reserved book and its
   quantity are fixed, and anything else on the shelf may ride along in the
   same order. OPEN invites render the ordinary CheckoutView with contact
   fields pre-filled — the cart is the shopper's own, so there is nothing
   invite-specific about the rest of that page. */

/** How many other titles the invite page offers. A checkout is not a shop
    window: enough to be worth a look, not enough to become a decision. */
const ALSO_AVAILABLE_LIMIT = 6;

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

  /* What else the customer may put in the same box.
     Fetched here rather than in the client component for the reason the whole
     catalog is server-rendered: there is no client-side book list in this app,
     and adding one to a checkout page would be a network round trip in front
     of the only screen where hesitation costs a sale. */
  const alsoAvailable =
    invite.mode === "LOCKED" ? await offerableBooks([invite.bookId!], ALSO_AVAILABLE_LIMIT) : [];

  return (
    <PageShell header={<AppNav brandHref={path.home} />}>
      {invite.mode === "LOCKED" ? (
        <InviteCheckoutView
          locale={locale}
          token={token}
          bookId={invite.bookId!}
          quantity={invite.quantity}
          prefill={prefill}
          alsoAvailable={alsoAvailable}
        />
      ) : (
        <CheckoutView locale={locale} prefill={prefill} inviteToken={token} />
      )}
    </PageShell>
  );
}
