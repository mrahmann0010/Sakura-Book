"use client";

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Order } from "@sakura/contracts";

import { OrderLine, OrderProgress, SummaryRow } from "@/components/domain";
import { toOrderProgressStep } from "./order-status";
import { ReceiptSheet, SHEET_H, SHEET_W } from "./receipt-sheet";
import { Button, Card, CopyButton, Notice, OrderId, StatusPill } from "@/components/ui";
import type { Locale } from "@/i18n/settings";
import { formatMoney, intlLocale } from "@/lib/money";

/* --------------------------------------------------------------------------
   The full receipt shown on a confirmation screen: order ID, status, line
   items, cost breakdown, payment, and a "download as PDF".

   Lives here rather than under components/checkout because both confirmation
   screens draw it — the ordinary cart checkout and the waitlist-invite one —
   and neither owns it. It takes an `Order` and nothing else, so any page
   holding one can render it; see OrderPlaced, which is how both currently do.

   The screen and the download are two different layouts, which is the change
   this file records. They used to be one: the button pointed html2canvas at
   the on-screen cards, so the PDF came out as a photograph of a web page —
   screen-shaped rather than A4, carrying a copy button, a progress tracker
   and a "save this somewhere" prompt that mean nothing on paper, and in dark
   mode rendering themed text onto a hard-coded white background. The download
   now rasterises ReceiptSheet instead, which is a document: A4, unthemed,
   paginated, and never visible on screen.

   Rasterising is still the mechanism, and still for the original reason — the
   app ships three real scripts (en/ja/bn) and jsPDF's built-in fonts cannot
   draw Japanese or Bengali without embedded font files. Drawing the sheet in
   whatever fonts the page already loaded sidesteps that entirely, at the cost
   of a larger file and non-selectable text.
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

/** A4 in points — the page size every viewer and printer already expects. */
const A4_PT_W = 595.28;
const A4_PT_H = 841.89;

export function OrderReceipt({ order, locale }: { order: Order; locale: Locale }) {
  const { t } = useTranslation();
  const sheetRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);

  const step = toOrderProgressStep(order.status);

  async function downloadReceipt() {
    const host = sheetRef.current;
    if (!host) return;

    setDownloading(true);
    setDownloadError(false);

    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);

      /* The sheet is set in Lora and Public Sans. Rasterising before those
         have loaded bakes the Georgia/Arial fallbacks into the PDF
         permanently — the one class of visual bug a screenshot cannot
         recover from on a later render. Cheap on a warm page, since the
         confirmation screen is already using both. */
      if (document.fonts?.ready) await document.fonts.ready;

      const pages = Array.from(host.querySelectorAll<HTMLElement>("[data-receipt-page]"));
      if (pages.length === 0) throw new Error("receipt sheet did not render");

      const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });

      for (const [index, page] of pages.entries()) {
        const canvas = await html2canvas(page, {
          backgroundColor: "#ffffff",
          scale: 2,
          /* The sheet is its own fixed A4 box, so tell html2canvas that
             rather than letting it infer a size from an off-canvas element
             parked outside the viewport. */
          width: SHEET_W,
          height: SHEET_H,
          windowWidth: SHEET_W,
          windowHeight: SHEET_H,
          scrollX: 0,
          scrollY: 0,
        });

        /* JPEG, not PNG: a lossless render of a mostly-flat, mostly-text
           sheet runs 5-6MB, a rough download on the mobile data the shop's
           customers actually order on. Quality 0.92 is visually identical
           for this kind of content and lands well under 500KB. */
        const image = canvas.toDataURL("image/jpeg", 0.92);

        if (index > 0) pdf.addPage("a4", "portrait");
        pdf.addImage(image, "JPEG", 0, 0, A4_PT_W, A4_PT_H);
      }

      pdf.save(`receipt-${order.orderNumber}.pdf`);
    } catch {
      setDownloadError(true);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      {/* The document, parked off-canvas.

          Not `display: none` and not `visibility: hidden`: html2canvas
          rasterises a live layout, and an element with no layout boxes draws
          as nothing. Pushed off the left edge instead, which keeps it
          measurable while keeping it unreachable — `aria-hidden` and
          `inert`-by-absence of any focusable content keep it out of the
          accessibility tree, and the fixed position keeps it from extending
          the page's scroll width. */}
      <div
        ref={sheetRef}
        aria-hidden="true"
        style={{
          position: "fixed",
          left: "-10000px",
          top: 0,
          width: `${SHEET_W}px`,
          pointerEvents: "none",
        }}
      >
        <ReceiptSheet order={order} />
      </div>

      <div className="bg-page flex flex-col gap-5">
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
