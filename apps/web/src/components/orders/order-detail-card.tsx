"use client";

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Order, OrderStatus } from "@sakura/contracts";

import { OrderProgress, type OrderProgressStep } from "@/components/domain";
import { Button, Card, CopyButton, OrderId, StatusPill } from "@/components/ui";
import type { Locale } from "@/i18n/settings";
import { deliveryWindow, formatDate, formatDateTime, formatTime } from "@/lib/dates";
import { cn } from "@/lib/utils";

import { OrderSummaryLines } from "./order-receipt";
import { toOrderProgressStep } from "./order-status";

/* --------------------------------------------------------------------------
   One order, answering the questions a customer actually opens this page to
   ask, in the order they ask them: has my money been checked, has it been
   packed, has it left, and when will it arrive.

   Everything else — what was in the box, what it cost, where it is going — is
   real but secondary, and sits behind a disclosure rather than above the fold.
   That is the whole layout decision here: someone refreshing on a phone is
   checking one fact, and making them scroll past their own address to reach a
   progress bar is the page answering a question they did not ask.
   -------------------------------------------------------------------------- */

/** When a given status was reached, or null if it has not been. */
function occurredAt(order: Order, status: OrderStatus): string | null {
  for (let i = order.timeline.length - 1; i >= 0; i--) {
    if (order.timeline[i].status === status) return order.timeline[i].occurredAt;
  }
  return null;
}

/**
 * Timestamps under each stage of the bar. Built latest-wins per stage, so
 * DELIVERED overwrites SHIPPED where both map to the same one.
 */
function progressDetail(
  order: Order,
  locale: Locale,
): Partial<Record<OrderProgressStep, ReactNode>> {
  const detail: Partial<Record<OrderProgressStep, ReactNode>> = {};

  for (const event of order.timeline) {
    const step = toOrderProgressStep(event.status);
    if (!step) continue;

    const when = formatDateTime(event.occurredAt, locale);
    detail[step] = event.note ? `${when} — ${event.note}` : when;
  }

  return detail;
}

/** The most recent timeline note — the reason a cancelled/refunded order shows one. */
function lastNote(order: Order): string | null {
  for (let i = order.timeline.length - 1; i >= 0; i--) {
    const note = order.timeline[i].note;
    if (note) return note;
  }
  return null;
}

export type OrderDetailCardProps = {
  order: Order;
  locale: Locale;
  /** When the data on screen was last fetched. Omitted on a static render. */
  updatedAt?: number;
  /** Refetch. Absent when the caller has nothing to refresh with. */
  onRefresh?: () => void;
  refreshing?: boolean;
};

export function OrderDetailCard({
  order,
  locale,
  updatedAt,
  onRefresh,
  refreshing = false,
}: OrderDetailCardProps) {
  const { t } = useTranslation();
  const [detailsOpen, setDetailsOpen] = useState(false);

  const step = toOrderProgressStep(order.status);
  const confirmedAt = occurredAt(order, "PAYMENT_CONFIRMED");

  /* The headline: one sentence saying where the order stands, in the words a
     customer would use. The progress bar below shows the same thing as a
     shape; this says it outright, because a bar is read as a picture and a
     worried person wants a sentence. */
  const headline = t(`orders.headline.${order.status}`);

  /* Two to three days from the moment payment cleared — see deliveryWindow for
     why it is anchored there and not to placedAt. Withheld once the parcel is
     delivered (it arrived; an estimate is noise) and for terminal states. */
  const estimate =
    confirmedAt && order.status !== "DELIVERED" && step
      ? (() => {
          const { from, to } = deliveryWindow(confirmedAt);
          return t("orders.estimate", {
            from: formatDate(from.toISOString(), locale),
            to: formatDate(to.toISOString(), locale),
          });
        })()
      : null;

  return (
    <div className="mt-10 flex flex-col gap-5">
      <Card variant="tint" padding="roomy">
        <div className="flex items-baseline justify-between gap-4">
          <p className="eyebrow">{t("orders.orderLabel")}</p>
          <CopyButton value={order.orderNumber} />
        </div>
        <OrderId className="mt-2.5 block">{order.orderNumber}</OrderId>

        {step ? (
          <>
            <p className="text-h3 text-ink mt-6 font-serif leading-snug">{headline}</p>
            {estimate ? <p className="text-body mt-2">{estimate}</p> : null}

            <OrderProgress
              status={step}
              orientation="vertical"
              detail={progressDetail(order, locale)}
              className="mt-8"
            />
          </>
        ) : (
          <div className="mt-6">
            <StatusPill status="cancelled">
              {t(`orders.status.${order.status === "REFUNDED" ? "refunded" : "cancelled"}`)}
            </StatusPill>
            <p className="text-h3 text-ink mt-4 font-serif leading-snug">{headline}</p>
            {lastNote(order) ? <p className="text-body mt-3">{lastNote(order)}</p> : null}
          </div>
        )}

        {/* Freshness belongs with the status, not at the foot of the page:
            the whole reason to show a "last checked" time is that the thing
            above it may have moved since. */}
        {updatedAt && onRefresh ? (
          <div className="hairline mt-8 flex flex-wrap items-center justify-between gap-3 pt-5">
            <p className="text-caption text-secondary">
              {t("orders.lastChecked", {
                time: formatTime(new Date(updatedAt).toISOString(), locale),
              })}
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={refreshing}
              loadingLabel={t("orders.refreshing")}
              onClick={onRefresh}
            >
              {t("orders.refresh")}
            </Button>
          </div>
        ) : null}
      </Card>

      {/* The rest of the order, folded away. Its own card so that opening it
          pushes nothing above it around. */}
      <Card padding="none" className="overflow-hidden">
        <button
          type="button"
          onClick={() => setDetailsOpen((open) => !open)}
          aria-expanded={detailsOpen}
          aria-controls="order-details"
          className="px-card-compact min-h-touch flex w-full items-center justify-between gap-4 py-3.5 text-left"
        >
          <span className="text-13.5 text-ink font-medium">
            {t("orders.detailsToggle", { count: order.lines.length })}
          </span>
          <span
            aria-hidden
            className={cn(
              "text-muted text-10 transition-transform duration-150",
              detailsOpen && "rotate-180",
            )}
          >
            ▾
          </span>
        </button>

        {detailsOpen ? (
          <div id="order-details" className="px-card-compact hairline pt-5 pb-6">
            <OrderSummaryLines order={order} locale={locale} />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
