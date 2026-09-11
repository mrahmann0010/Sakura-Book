"use client";

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Order } from "@sakura/contracts";

import { OrderLine, OrderProgress, SummaryRow } from "@/components/domain";
import { toOrderProgressStep } from "./order-status";
import { Button, Card, CopyButton, Notice, OrderId, StatusPill } from "@/components/ui";
import type { Locale } from "@/i18n/settings";
import { formatMoney, intlLocale } from "@/lib/money";

/* --------------------------------------------------------------------------
   The full receipt shown on a confirmation screen: order ID, status, line
   items, cost breakdown, payment, and a client-side "download as PDF" of
   everything in `receiptRef` (the two cards, not the actions below them).

   Lives here rather than under components/checkout because both confirmation
   screens draw it — the ordinary cart checkout and the waitlist-invite one —
   and neither owns it. It takes an `Order` and nothing else, so any page
   holding one can render it; see OrderPlaced, which is how both currently do.

   The PDF is a screenshot (html2canvas → jsPDF), not text drawn by jsPDF
   itself — the app ships three real scripts (en/ja/bn) and jsPDF's built-in
   fonts cannot render Japanese or Bengali without manually embedding font
   files. Rasterising whatever is already on screen, in whatever font the
   page already loaded, sidesteps that entirely at the cost of a larger file
   and non-selectable text — an acceptable trade for a receipt.
   -------------------------------------------------------------------------- */

/**
 * What was bought, what it cost, how it was paid for, and where it is going —
 * without a Card around it.
 *
 * Unwrapped on purpose: the receipt below puts it in a tinted card, and the
 * tracking page puts the same markup inside a disclosure that is already a
 * card of its own. Returning a Card here would have made the second caller
 * nest one inside another.
 */
export function OrderSummaryLines({ order, locale }: { order: Order; locale: Locale }) {
  const { t } = useTranslation();

  const money = intlLocale(locale);
  const itemCount = order.lines.reduce((sum, line) => sum + line.quantity, 0);

  const paymentLabel = order.paymentProvider
    ? t(`checkout.payment.${order.paymentProvider}`)
    : t(`checkout.payment.${order.paymentMethod}`, { defaultValue: order.paymentMethod });

  const paymentPill =
    order.status === "PENDING"
      ? "pending"
      : order.status === "CANCELLED" || order.status === "REFUNDED"
        ? "cancelled"
        : "paid";

  return (
    <>
      <p className="eyebrow">{t("checkout.placed.itemsHeading", { count: order.lines.length })}</p>

      <div className="mt-4 flex flex-col">
        {order.lines.map((line, index) => (
          <OrderLine
            key={`${line.bookId ?? line.slug ?? line.title}-${index}`}
            size="md"
            book={{
              id: line.bookId ?? line.slug ?? line.title,
              title: line.title,
              author: line.authors.join(", "),
              priceCents: line.unitPriceCents,
              coverUrl: line.coverImageUrl ?? undefined,
            }}
            quantity={line.quantity}
            amount={formatMoney(line.lineTotalCents, money, order.currency)}
          />
        ))}
      </div>

      <div className="hairline mt-2 flex flex-col gap-3.5 pt-5">
        <SummaryRow
          label={t("cart.summary.subtotal", { count: itemCount })}
          value={formatMoney(order.subtotalCents, money, order.currency)}
        />
        <SummaryRow
          label={t("cart.summary.delivery")}
          value={formatMoney(order.deliveryCents, money, order.currency)}
        />
        {order.discountCents > 0 ? (
          <SummaryRow
            tone="credit"
            label={t("checkout.placed.discount")}
            value={`− ${formatMoney(order.discountCents, money, order.currency)}`}
          />
        ) : null}
      </div>

      <SummaryRow
        tone="total"
        label={t("cart.summary.total")}
        value={formatMoney(order.totalCents, money, order.currency)}
      />

      <div className="hairline mt-5 flex items-center justify-between gap-4 pt-5">
        <div>
          <p className="eyebrow">{t("checkout.placed.payment")}</p>
          <p className="text-13.5 text-ink mt-1.5 font-medium">{paymentLabel}</p>
        </div>
        {/* Three states, not two. The old `PENDING ? pending : paid` put a
            green "Paid" on a cancelled order, and on a refunded one — and the
            pill's own fallback labels are English, which is not something a
            Bangla page should be showing. */}
        <StatusPill status={paymentPill}>{t(`orders.payment.${paymentPill}`)}</StatusPill>
      </div>

      {/* Where it is going. On the receipt because a receipt should say so,
          and on the tracking page because "did I type my address correctly"
          is the second thing a worried customer wants to check. */}
      <div className="hairline mt-5 pt-5">
        <p className="eyebrow">{t("orders.deliveringTo")}</p>
        <p className="text-13.5 text-ink mt-1.5 font-medium">{order.shipping.fullName}</p>
        {/* Street and district only. `shipping.region` is a delivery-zone slug
            ("inside-dhaka"), not a place — printing it put a piece of the
            pricing model into the customer's address. */}
        <p className="text-caption text-secondary mt-1">
          {order.shipping.address}, {order.shipping.city}
        </p>
        <p className="text-caption text-secondary mt-1">
          {order.shipping.phone}
          {order.shipping.secondaryPhone ? ` · ${order.shipping.secondaryPhone}` : ""}
        </p>
      </div>
    </>
  );
}

export function OrderReceipt({ order, locale }: { order: Order; locale: Locale }) {
  const { t } = useTranslation();
  const receiptRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);

  const step = toOrderProgressStep(order.status);

  async function downloadReceipt() {
    const node = receiptRef.current;
    if (!node) return;

    setDownloading(true);
    setDownloadError(false);

    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);

      const canvas = await html2canvas(node, { backgroundColor: "#ffffff", scale: 2 });
      /* JPEG, not PNG: a lossless screenshot of a mostly-flat, mostly-text
         card runs 5-6MB, a rough download on the mobile data the shop's
         customers actually order on. Quality 0.92 is visually identical for
         this kind of content and lands under 500KB. */
      const image = canvas.toDataURL("image/jpeg", 0.92);

      /* Points, at the canvas's own CSS pixel size (scale:2 doubles the
         bitmap, not the layout box) — one page, sized exactly to the
         content, rather than fitting a fixed page format. */
      const width = canvas.width / 2;
      const height = canvas.height / 2;
      const pdf = new jsPDF({ unit: "pt", format: [width, height] });
      pdf.addImage(image, "JPEG", 0, 0, width, height);
      pdf.save(`receipt-${order.orderNumber}.pdf`);
    } catch {
      setDownloadError(true);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <div ref={receiptRef} className="bg-page flex flex-col gap-5">
        <Card variant="tint" padding="roomy">
          <div className="flex items-baseline justify-between gap-4">
            <p className="eyebrow">{t("checkout.placed.orderId")}</p>
            <CopyButton value={order.orderNumber} />
          </div>
          <OrderId className="mt-2.5 block">{order.orderNumber}</OrderId>
          <p className="text-caption text-secondary mt-2.5">{t("checkout.placed.copyPrompt")}</p>

          {step ? (
            <OrderProgress status={step} className="mt-8" />
          ) : (
            <StatusPill status="cancelled" className="mt-8">
              {t(`orders.status.${order.status === "REFUNDED" ? "refunded" : "cancelled"}`)}
            </StatusPill>
          )}
        </Card>

        <Card variant="tint" padding="roomy">
          <OrderSummaryLines order={order} locale={locale} />
        </Card>
      </div>

      <Button
        type="button"
        variant="secondary"
        block
        className="mt-5"
        loading={downloading}
        loadingLabel={t("checkout.placed.downloadReceipt")}
        onClick={downloadReceipt}
      >
        {t("checkout.placed.downloadReceipt")}
      </Button>

      {downloadError ? (
        <Notice tone="error" className="mt-3">
          {t("checkout.placed.downloadFailed")}
        </Notice>
      ) : null}
    </>
  );
}
