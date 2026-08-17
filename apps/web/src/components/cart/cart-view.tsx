"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { CartItem, CartItemList, EmptyState, SummaryCard, SummaryRow } from "@/components/domain";
import { PageHeader, Shell, RailLayout, StickyBar } from "@/components/layout";
import { LinkButton, Skeleton, SkeletonText } from "@/components/ui";
import { useCart } from "@/hooks/use-cart";
import type { Locale } from "@/i18n/settings";
import { titlesInStock } from "@/lib/books";
import { FREE_DELIVERY_THRESHOLD, summaryLines } from "@/lib/cart";
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

/** How long a removed line stays undoable. */
const UNDO_WINDOW_MS = 5000;

export function CartView({ locale }: { locale: Locale }) {
  const { t } = useTranslation();
  const path = routes(locale);
  const cart = useCart();

  /* A removal is staged, not immediate: the row goes to the "removing" state
     with an Undo, and only commits when the window closes. The line stays in
     the totals until then — nothing has actually been removed yet, and a total
     that drops before the removal is final would be lying. */
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const stageRemoval = useCallback(
    (bookId: string) => {
      clearTimer();
      setPendingRemoval(bookId);
      timer.current = setTimeout(() => {
        cart.remove(bookId);
        setPendingRemoval(null);
      }, UNDO_WINDOW_MS);
    },
    [cart, clearTimer],
  );

  const undoRemoval = useCallback(() => {
    clearTimer();
    setPendingRemoval(null);
  }, [clearTimer]);

  if (!cart.hydrated) return <CartSkeleton label={t("cart.loading")} />;

  if (cart.isEmpty) {
    return (
      <Shell className="py-14 lg:py-20">
        <PageHeader size="lg" title={t("cart.title")} />
        <EmptyState
          className="mt-10"
          eyebrow={t("cart.empty.eyebrow")}
          title={t("cart.empty.title")}
          description={t("cart.empty.description", { count: titlesInStock })}
          action={<LinkButton href={path.catalog}>{t("cart.empty.action")}</LinkButton>}
        />
      </Shell>
    );
  }

  /* One BCP 47 tag for every amount on the page. Derived once so a row
     cannot end up formatted for a different locale than the total below it. */
  const money = intlLocale(locale);

  const rows = summaryLines(
    cart,
    {
      subtotal: (count) => t("cart.summary.subtotal", { count }),
      delivery: t("cart.summary.delivery"),
      deliveryFree: t("cart.summary.deliveryFree", {
        threshold: formatMoney(FREE_DELIVERY_THRESHOLD, money),
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

          <CartItemList>
            {cart.lines.map((line) => (
              <CartItem
                key={line.book.id}
                book={line.book}
                quantity={line.quantity}
                lineTotal={formatMoney(line.lineTotal, money)}
                removing={pendingRemoval === line.book.id}
                onQuantityChange={(quantity) => cart.setQuantity(line.book.id, quantity)}
                onRemove={() => stageRemoval(line.book.id)}
                onUndoRemove={undoRemoval}
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
