import type { ReactNode } from "react";

import { Shell } from "@/components/layout";

/* --------------------------------------------------------------------------
   The book page's purchase control on a phone, pinned to the bottom edge.

   The book page is long — a cover, six paragraphs of description, a meta
   block and a gallery — and Buy Now used to live in a card about a third of
   the way down it. Everywhere else on the page there was no way to buy the
   book without scrolling back up to look for one, which on the one screen
   devoted to a single title is the whole purpose of the page going missing.

   It carries the price beside the button rather than the button alone,
   because a control that commits somebody to a payment should say what the
   payment is at the moment it is pressed, not only where it was read.

   Not rendered at `lg:`: the sticky buy rail already keeps the same control
   beside the description there, and two pinned purchase controls on one
   screen is the mistake this replaces, not a bigger version of the fix.
   -------------------------------------------------------------------------- */

export function MobileBuyBar({
  price,
  /** Struck-through, and only when the caller has established it is genuinely higher. */
  compareAtPrice,
  /** The BuyNowButton, built by the page that knows the book. */
  action,
}: {
  price: string;
  compareAtPrice?: ReactNode;
  action: ReactNode;
}) {
  return (
    <div
      /* The same frost recipe and the same z-40 as the floating nav — this is
         the other end of the same bar, and a second blur value would read as a
         second kind of surface. The sample reader sits above both at z-50. */
      className="bg-frost border-rule fixed inset-x-0 bottom-0 z-40 border-t [backdrop-filter:blur(12px)_saturate(180%)] lg:hidden"
      /* The home indicator's strip on an iPhone. Without it the button's
         bottom edge sits under the gesture bar, where a press is a swipe. */
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <Shell className="flex items-center gap-4 py-3">
        <p className="flex shrink-0 flex-col leading-tight">
          <span className="text-19 text-ink font-serif">{price}</span>
          {compareAtPrice ? (
            <span className="text-11.5 text-muted line-through">{compareAtPrice}</span>
          ) : null}
        </p>
        <div className="min-w-0 flex-1">{action}</div>
      </Shell>
    </div>
  );
}
