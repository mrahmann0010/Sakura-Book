"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";

import { CartItem, CartItemList, EmptyState, SummaryCard, SummaryRow } from "@/components/domain";
import { PageHeader, Shell, RailLayout, StickyBar } from "@/components/layout";
import { LinkButton, Notice, Skeleton, SkeletonText } from "@/components/ui";
import { useCart } from "@/hooks/use-cart";
import { useCartStepEvent } from "@/hooks/use-cart-step-event";
import type { Locale } from "@/i18n/settings";
import { titlesInStock } from "@/lib/books";
import { summaryLines } from "@/lib/cart";
import { formatMoney, intlLocale } from "@/lib/money";
import { routes } from "@/lib/routes";

/* --------------------------------------------------------------------------
   The cart page's one job: change what you are buying.

   Quantities, removals and the line-by-line arithmetic — and nothing else. It
   asks for no address, offers no payment method and takes no decision that
   belongs to checkout. The single way forward is one button.

   Client-side because the cart lives in the browser (Redux + redux-persist).
   Everything else about the page — the shell, the header, the copy — is
   rendered by the server component that mounts this.
   -------------------------------------------------------------------------- */

/* --------------------------------------------------------------------------
   Removal is immediate.

   It used to be staged behind a five-second undo window: Remove dimmed the row
   and set a timer, and only when that timer fired did `cart.remove` reach Redux
   and localStorage. The unmount cleanup then cleared every pending timer
   *without committing it*, so navigating away — or reloading — inside those
   five seconds silently cancelled the removal. The row and the subtotal had
   already dropped, so the cart looked emptied; the entry was still persisted,
   and came back on the next visit, forever, because the only code path that
   could delete it needed five uninterrupted seconds on this page.

   The undo affordance is not worth a removal that does not remove. Remove now
   dispatches straight through, and the requote that follows is the confirmation.
   `CartItem` keeps its `removing` / `onUndoRemove` props — nothing here passes
   them any more, but the component still supports an undo window if one is
   ever reintroduced, as a *committed* removal that can be re-added.

   The old rule, for reference:

     const UNDO_WINDOW_MS = 5000;
     // stageRemoval: dim the row, setTimeout(() => cart.remove(bookId), 5000)
     // undoRemoval:  clearTimeout, un-dim
     // unmount:      clearTimeout on all pending — the bug
   -------------------------------------------------------------------------- */

export function CartView({ locale }: { locale: Locale }) {
  const { t } = useTranslation();
  const path = routes(locale);
  const cart = useCart();

  useCartStepEvent("view_cart", cart);

  /* Hydration is one wait, quoting is another: localStorage can hand back
     entries before the server has priced them, and showing the empty state
     in that gap would flash "your cart is empty" at someone whose cart is
     not. Only render it once a quote has actually come back with nothing in
     it — or there was never anything to quote. */
  if (!cart.hydrated || (cart.quoting && cart.lines.length === 0))
    return <CartSkeleton label={t("cart.loading")} />;

  if (cart.isEmpty) {
    return (
      <Shell className="py-14 lg:py-20">
        <PageHeader size="lg" title={t("cart.title")} />
        <EmptyState
          className="mt-10"
          eyebrow={t("cart.empty.eyebrow")}
          title={t("cart.empty.title")}
          description={
            cart.rejected.length > 0
              ? t("cart.rejectedNotice", { count: cart.rejected.length })
              : t("cart.empty.description", { count: titlesInStock })
          }
          action={<LinkButton href={path.catalog}>{t("cart.empty.action")}</LinkButton>}
        />
      </Shell>
    );
  }

  /* One BCP 47 tag for every amount on the page. Derived once so a row
     cannot end up formatted for a different locale than the total below it. */
  const money = intlLocale(locale);

  /* `cart.lines` is the last answer from POST /cart/quote, not Redux. When a
     removal commits, the requote for the shortened cart is briefly in flight
     and `keepPreviousData` keeps handing back the quote that still contains
     the removed book — so without this filter the row would reappear at full
     opacity for exactly one round-trip. That is the flash. `cart.entries`
     changes in the same tick as the dispatch, so a line the cart no longer
     holds is hidden immediately. */
  const entryIds = new Set(cart.entries.map((entry) => entry.bookId));
  const visibleLines = cart.lines.filter((line) => entryIds.has(line.book.id));

  /* The totals are the server's, not a client recomputation of them: the page
     renders the same quote checkout will charge against, so the two cannot
     disagree about postage. The rail lags a removal by one round-trip, which
     is the honest thing to show — the customer is quoted a total only once the
     shop has actually quoted it. */
  const rows = summaryLines(
    cart,
    {
      subtotal: (count) => t("cart.summary.subtotal", { count }),
      delivery: t("cart.summary.delivery"),
      deliveryFree:
        cart.freeDeliveryThreshold === null
          ? null
          : t("cart.summary.deliveryFree", {
              threshold: formatMoney(cart.freeDeliveryThreshold, money),
            }),
    },
    money,
  );

  const total = formatMoney(cart.total, money);

  /* One node, rendered into the rail on desktop and the docked bar on mobile —
     the same button, never two that can drift apart. */
  const checkoutAction = (
    <LinkButton href={path.checkout} block>
      {t("cart.summary.checkout")}
    </LinkButton>
  );

  return (
    <>
      <Shell className="py-14 lg:py-20">
        <PageHeader
          size="lg"
          eyebrow={t("cart.eyebrow", { count: cart.itemCount })}
          title={t("cart.title")}
        />

        <RailLayout
          className="mt-10"
          rail={
            <SummaryCard
              title={t("cart.summary.title")}
              footer={
                <div className="mt-6 hidden lg:block">
                  {checkoutAction}
                  <p className="text-caption text-secondary mt-4 leading-relaxed">
                    {t("cart.summary.note")}
                  </p>
                </div>
              }
            >
              {rows.map((row) => (
                <SummaryRow key={row.key} label={row.label} value={row.value} tone={row.tone} />
              ))}
              <SummaryRow tone="total" label={t("cart.summary.total")} value={total} />
            </SummaryCard>
          }
        >
          <h2 className="sr-only">{t("cart.items")}</h2>

          {cart.rejected.length > 0 ? (
            <Notice tone="error" className="mb-6">
              {t("cart.rejectedNotice", { count: cart.rejected.length })}
            </Notice>
          ) : null}

          <CartItemList>
            {visibleLines.map((line) => (
              <CartItem
                key={line.book.id}
                book={line.book}
                quantity={line.quantity}
                lineTotal={formatMoney(line.lineTotal, money)}
                onQuantityChange={(quantity) => cart.setQuantity(line.book.id, quantity)}
                onRemove={() => cart.remove(line.book.id)}
              />
            ))}
          </CartItemList>

          <Link
            href={path.catalog}
            className="text-13.5 text-secondary hover:text-clay mt-6 inline-flex items-center gap-2"
          >
            <span aria-hidden>←</span>
            {t("cart.continue")}
          </Link>
        </RailLayout>
      </Shell>

      <StickyBar label={t("cart.summary.total")} value={total} action={checkoutAction} />
    </>
  );
}

/**
 * Held through the first paint, while redux-persist reads localStorage. The
 * skeleton holds the shape of a two-line cart so nothing shifts when the real
 * cart lands — §6's rule about skeletons.
 */
function CartSkeleton({ label }: { label: string }) {
  return (
    <Shell className="py-14 lg:py-20" aria-busy="true" aria-label={label}>
      <Skeleton className="h-11 w-56" />
      <RailLayout className="mt-10" rail={<Skeleton className="rounded-container h-72" />}>
        <div className="hairline">
          {[0, 1].map((row) => (
            <div key={row} className="grid-line-lg border-rule items-start gap-6 border-b py-6">
              <Skeleton className="cover" />
              <div className="min-w-0">
                <SkeletonText lines={2} />
                <Skeleton className="mt-4 h-9 w-32" />
              </div>
              <Skeleton className="h-3 w-14" />
            </div>
          ))}
        </div>
      </RailLayout>
    </Shell>
  );
}
