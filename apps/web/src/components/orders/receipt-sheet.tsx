"use client";

import { useTranslation } from "react-i18next";
import type { Order, OrderLine } from "@sakura/contracts";

import { formatDate } from "@/lib/dates";
import { formatMoney, intlLocale } from "@/lib/money";

/* --------------------------------------------------------------------------
   The downloadable receipt — a document, not a picture of the screen.

   This is never visible. OrderReceipt mounts it off-canvas, rasterises it and
   throws it away; the confirmation screen the customer actually looks at is
   OrderSummaryLines, which is a different layout for a different job. The two
   were the same thing until now, and that was the bug: the download was
   html2canvas pointed at the on-screen cards, so the PDF inherited a copy
   button, a progress tracker, a "save this somewhere" prompt, screen
   proportions, and — in dark mode — white text on a forced white page.

   Three rules follow from being a document:

   1. A4, at a real A4 size. SHEET_W/SHEET_H are 210×297mm at 96dpi, and the
      PDF page is 595×842pt. Nothing here is sized from the viewport, so the
      output is identical on a phone and a desktop.

   2. Plain hex, in a <style> block, and not one Tailwind class. Two reasons.
      The palette must not follow the theme — a receipt is ink on paper and
      has no dark mode — and html2canvas parses CSS itself, so modern colour
      syntax (oklch, color-mix) that a utility layer may emit is a rendering
      risk it cannot warn about. Hard values are the deterministic choice for
      something that will be rasterised. The values are light-mode Marginalia,
      copied from styles/theme.css rather than referenced.

   3. Paginated by chunking the lines into whole pages, not by slicing the
      bitmap. Slicing a canvas at a fixed height cuts a book in half across
      the fold; chunking cannot, because the page break is decided before
      anything is drawn. See paginate().
   -------------------------------------------------------------------------- */

/**
 * The one language this document is ever issued in. See the note in
 * ReceiptSheet on why the sheet ignores the reader's locale.
 */
const RECEIPT_LOCALE = "en";

/** 210mm × 297mm at 96dpi — what one `<ReceiptSheet>` element measures. */
export const SHEET_W = 794;
export const SHEET_H = 1123;

/* --------------------------------------------------------------------------
   Pagination

   The fixed furniture on a page, in CSS pixels. These decide how many lines
   go on each sheet, so being wrong in the unsafe direction clips content:
   `.rs-page` is `overflow: hidden` at a fixed height, which contains a
   mistake to one page rather than letting it bleed into the next, but a row
   sliced in half is still a ruined receipt.

   So they are measured in the browser rather than guessed, against the worst
   realistic content — a long Bangla title with two authors.

   ROW_H is the one that has to be a ceiling rather than an average, because
   it is multiplied. It is set to the height of a row whose title wraps onto a
   *second* line; titles are never truncated, so a third line is possible in
   principle, but two lines of 13.5px serif across this column is about ninety
   characters and nothing in the catalogue comes close. The arithmetic leaves
   room for the bound to be met on every row at once: five rows at ROW_H plus
   both fixed blocks is 997 of the 1019 available.
   -------------------------------------------------------------------------- */

/** Masthead, rule, the two address columns, and the table head. Measured 247. */
const HEAD_H = 250;
/** The same on a continuation page, which repeats only a slim identity strip. */
const HEAD_CONT_H = 120;
/** Totals panel, payment strip and footer — they travel on the last page. */
const SUMMARY_H = 337;
/** A row at its tallest: two title lines, the authors, and the padding. */
const ROW_H = 82;
/** Page box minus the 52px top and bottom margins. */
const BODY_H = SHEET_H - 104;

type Page = { lines: OrderLine[]; summary: boolean };

/**
 * Lines → pages, with the summary landing on the last one.
 *
 * Greedy, and it only ever looks one page ahead: fill the page, and if what
 * is left over also fits *with* the summary block, this is the last page.
 * The loop always makes progress — `fit` is at least 1 on every page — so a
 * hundred-line order terminates rather than paginating forever.
 */
export function paginate(lines: OrderLine[]): Page[] {
  const pages: Page[] = [];
  let rest = lines;

  while (rest.length > 0 || pages.length === 0) {
    const head = pages.length === 0 ? HEAD_H : HEAD_CONT_H;
    const withSummary = Math.max(1, Math.floor((BODY_H - head - SUMMARY_H) / ROW_H));
    const alone = Math.max(1, Math.floor((BODY_H - head) / ROW_H));

    if (rest.length <= withSummary) {
      pages.push({ lines: rest, summary: true });
      return pages;
    }

    /* Everything left fits on this page, but not alongside the summary. A
       greedy fill would print all of it here and leave the totals marooned on
       a sheet of their own, which is the one genuinely shabby-looking output
       this paginator can produce. Split the remainder down the middle
       instead, so both pages carry books. Safe by construction: half of
       something that already fitted whole cannot overflow, and the next
       page's allowance is larger, since it repeats only the slim identity
       strip rather than the full masthead. */
    const take = rest.length <= alone ? Math.ceil(rest.length / 2) : alone;

    pages.push({ lines: rest.slice(0, take), summary: false });
    rest = rest.slice(take);
  }

  /* Everything fitted but the summary did not — it gets a page of its own
     rather than being dropped, which is the one case the loop above exits
     without having placed it. */
  pages.push({ lines: [], summary: true });
  return pages;
}

/* --------------------------------------------------------------------------
   What the payment block says

   Two separate questions that the screen's three-state pill conflates, and a
   receipt has to answer both: *how* it was paid, and whether the money has
   been confirmed. Cash on delivery is the case that makes them different —
   an undelivered COD order is neither paid nor unverified, it is simply not
   due yet, and printing "Awaiting verification" on one would be wrong.
   -------------------------------------------------------------------------- */

const VERIFIED_STATUSES = ["PAYMENT_CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED"] as const;

function paymentStateOf(order: Order): { key: string; tone: "settled" | "open" | "void" } {
  if (order.status === "CANCELLED") return { key: "cancelled", tone: "void" };
  if (order.status === "REFUNDED") return { key: "refunded", tone: "void" };

  const settled = (VERIFIED_STATUSES as readonly string[]).includes(order.status);

  if (order.paymentMethod === "cash-on-delivery") {
    return order.status === "DELIVERED"
      ? { key: "paidOnDelivery", tone: "settled" }
      : { key: "onDelivery", tone: "open" };
  }

  return settled ? { key: "verified", tone: "settled" } : { key: "awaiting", tone: "open" };
}

/**
 * The whole document, as one array of A4 pages.
 *
 * Returns a fragment of sibling `.rs-page` elements rather than a wrapper,
 * so the caller can walk them and rasterise each into its own PDF page.
 */
export function ReceiptSheet({ order }: { order: Order }) {
  /* English, whatever the reader was browsing in — and the one place in this
     app that deliberately ignores the locale.

     Not a shortcut. The shop's two typefaces, Lora and Public Sans, carry no
     Bengali or Japanese glyphs, so a translated sheet was not being set in
     the shop's typography at all: every label fell back to whatever face the
     browser happened to substitute, which matched nothing else on the page.
     The numbers then disagreed with themselves — Intl gives Bengali numerals
     for money (১,৭০০.০০৳) while the quantity column stayed Latin — and the
     mono small-caps label, which is the design system's most repeated
     device, is a Latin convention with no Bengali equivalent.

     One canonical English document is the honest answer to all three, and it
     is also the more useful one: a receipt gets forwarded to couriers, banks
     and employers who may read none of the three languages.

     Book titles are the exception and stay exactly as the catalogue holds
     them, Bangla included — a receipt has to name the book that was actually
     bought, so those are data, not copy. */
  const { i18n } = useTranslation();
  const t = i18n.getFixedT(RECEIPT_LOCALE);

  const cash = (n: number) => formatMoney(n, intlLocale(RECEIPT_LOCALE), order.currency);

  const payment = paymentStateOf(order);
  /* "Receipt" only once the money is in. On a pending transfer this sheet is
     a confirmation of what was ordered, and calling it a receipt would be the
     document asserting something the shop has not verified. */
  const docLabel = payment.tone === "settled" ? t("receipt.title") : t("receipt.provisional");

  const methodLabel = order.paymentProvider
    ? t(`checkout.payment.${order.paymentProvider}`)
    : t(`checkout.payment.${order.paymentMethod}`, { defaultValue: order.paymentMethod });

  /* Books, not lines — "Subtotal · 3 books" counts copies, matching the cart
     and the confirmation screen. */
  const itemCount = order.lines.reduce((sum, line) => sum + line.quantity, 0);

  const pages = paginate(order.lines);

  return (
    <>
      <style>{SHEET_CSS}</style>

      {pages.map((page, index) => (
        <div className="rs-page" key={index} data-receipt-page="">
          {index === 0 ? (
            <header className="rs-masthead">
              <div>
                <div className="rs-brand">Nihonova Books</div>
                <div className="rs-brand-sub">{SHOP_EMAIL}</div>
              </div>
              <div className="rs-meta">
                <div className="rs-doclabel">{docLabel}</div>
                <div className="rs-orderno">{order.orderNumber}</div>
                <div className="rs-issued">
                  {t("receipt.issued")} {formatDate(order.placedAt, RECEIPT_LOCALE)}
                </div>
              </div>
            </header>
          ) : (
            <header className="rs-masthead rs-masthead-cont">
              <div className="rs-brand-sm">Nihonova Books</div>
              <div className="rs-issued">
                {docLabel} · {order.orderNumber}
              </div>
            </header>
          )}

          <div className="rs-rule-double" />

          {index === 0 ? (
            <section className="rs-parties">
              <div>
                <div className="rs-label">{t("receipt.issuedTo")}</div>
                <div className="rs-party-name">{order.shipping.fullName}</div>
                <div className="rs-party-line">
                  {order.shipping.phone}
                  {order.shipping.secondaryPhone ? ` · ${order.shipping.secondaryPhone}` : ""}
                </div>
              </div>
              <div>
                <div className="rs-label">{t("receipt.deliveredTo")}</div>
                {/* `shipping.region` stays off the sheet on purpose: it is a
                    delivery-zone slug ("inside-dhaka"), not a place. */}
                <div className="rs-party-line rs-party-address">{order.shipping.address}</div>
                <div className="rs-party-line">{order.shipping.city}</div>
              </div>
            </section>
          ) : null}

          {/* Skipped on a page that carries only the summary — paginate() can
              spill the totals onto a page of their own, and a column header
              with nothing under it reads as a rendering fault. */}
          {page.lines.length > 0 ? (
            <table className="rs-table">
              <thead>
                <tr>
                  <th className="rs-th">{t("receipt.col.item")}</th>
                  <th className="rs-th rs-num rs-col-qty">{t("receipt.col.qty")}</th>
                  <th className="rs-th rs-num rs-col-unit">{t("receipt.col.unit")}</th>
                  <th className="rs-th rs-num rs-col-amount">{t("receipt.col.amount")}</th>
                </tr>
              </thead>
              <tbody>
                {page.lines.map((line, i) => (
                  <tr key={`${line.bookId ?? line.slug ?? line.title}-${i}`}>
                    <td className="rs-td">
                      <div className="rs-item-title">{line.title}</div>
                      {line.authors.length > 0 ? (
                        <div className="rs-item-authors">{line.authors.join(", ")}</div>
                      ) : null}
                    </td>
                    <td className="rs-td rs-num">{line.quantity}</td>
                    <td className="rs-td rs-num">{cash(line.unitPriceCents)}</td>
                    <td className="rs-td rs-num rs-amount">{cash(line.lineTotalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {page.summary ? (
            <>
              <section className="rs-totals-wrap">
                <div className="rs-totals">
                  <div className="rs-total-row">
                    <span className="rs-total-label">
                      {t("cart.summary.subtotal", { count: itemCount })}
                    </span>
                    <span className="rs-total-value">{cash(order.subtotalCents)}</span>
                  </div>
                  <div className="rs-total-row">
                    <span className="rs-total-label">{t("cart.summary.delivery")}</span>
                    <span className="rs-total-value">{cash(order.deliveryCents)}</span>
                  </div>
                  {order.discountCents > 0 ? (
                    <div className="rs-total-row">
                      <span className="rs-total-label">
                        {t("checkout.placed.discount")}
                        {order.couponCode ? ` (${order.couponCode})` : ""}
                      </span>
                      <span className="rs-total-value">− {cash(order.discountCents)}</span>
                    </div>
                  ) : null}
                  <div className="rs-grand">
                    <span className="rs-grand-label">{t("cart.summary.total")}</span>
                    <span className="rs-grand-value">{cash(order.totalCents)}</span>
                  </div>
                </div>
              </section>

              <section className="rs-payment">
                <div>
                  <div className="rs-label">{t("receipt.paymentMethod")}</div>
                  <div className="rs-party-line">{methodLabel}</div>
                </div>
                {/* Absent on cash on delivery, and on transfers placed before
                    the field was collected — no empty label in either case. */}
                {order.paymentSenderNumber ? (
                  <div>
                    <div className="rs-label">{t("receipt.sentFrom")}</div>
                    <div className="rs-party-line">{order.paymentSenderNumber}</div>
                  </div>
                ) : null}
                <div className="rs-payment-status">
                  <div className="rs-label">{t("receipt.paymentStatus")}</div>
                  <span className={`rs-stamp rs-stamp-${payment.tone}`}>
                    {t(`receipt.status.${payment.key}`)}
                  </span>
                </div>
              </section>
            </>
          ) : null}

          <footer className="rs-footer">
            <span className="rs-thanks">{t("receipt.thanks")}</span>
            <span className="rs-pagenum">
              {pages.length > 1
                ? t("receipt.page", { page: index + 1, total: pages.length })
                : SHOP_EMAIL}
            </span>
          </footer>
        </div>
      ))}
    </>
  );
}

/**
 * The shop's one printed contact detail.
 *
 * No address and no phone number, by decision: the shop has no counter to
 * visit, so a postal address on a receipt would be either a private home or
 * an invention, and both are worse than the email that actually answers.
 */
const SHOP_EMAIL = "nihonovaacademy@gmail.com";

/* --------------------------------------------------------------------------
   Ink on paper.

   Light-mode Marginalia values, written out rather than referenced — see the
   file header on why this sheet is deliberately unthemed. The type is the
   system's: Lora for titles and the total, Public Sans for body, and the mono
   caps label that is the design system's most repeated micro-pattern.

   The one flourish is the double rule under the masthead, which is what makes
   a sheet of A4 read as stationery rather than as a form.
   -------------------------------------------------------------------------- */
const SHEET_CSS = `
.rs-page {
  width: ${SHEET_W}px;
  height: ${SHEET_H}px;
  padding: 52px 56px;
  box-sizing: border-box;
  background: #ffffff;
  color: #3d3a34;
  font-family: var(--font-sans), Helvetica, Arial, sans-serif;
  font-size: 12.5px;
  line-height: 1.6;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.rs-masthead {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 32px;
}
.rs-masthead-cont { align-items: baseline; }

.rs-brand {
  font-family: var(--font-serif), Georgia, serif;
  font-size: 27px;
  line-height: 1.15;
  color: #141413;
  letter-spacing: 0.005em;
}
.rs-brand-sm {
  font-family: var(--font-serif), Georgia, serif;
  font-size: 15px;
  color: #141413;
}
.rs-brand-sub {
  margin-top: 6px;
  font-size: 11px;
  color: #6b665c;
}

.rs-meta { text-align: right; }
.rs-doclabel {
  font-family: var(--font-mono), ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #c96442;
}
.rs-orderno {
  margin-top: 5px;
  font-family: var(--font-mono), ui-monospace, monospace;
  font-size: 19px;
  letter-spacing: 0.04em;
  color: #141413;
}
.rs-issued {
  margin-top: 4px;
  font-size: 11px;
  color: #6b665c;
}

/* Two rules, 3px apart — letterpress stationery, and the cheapest possible
   signal that this is a document rather than a screen. */
.rs-rule-double {
  margin-top: 18px;
  border-top: 1.5px solid #141413;
  border-bottom: 0.5px solid #141413;
  height: 3px;
}

.rs-parties {
  display: flex;
  gap: 48px;
  margin-top: 26px;
}
.rs-parties > div { flex: 1 1 0; min-width: 0; }

.rs-label {
  font-family: var(--font-mono), ui-monospace, monospace;
  font-size: 9px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #8f8a7e;
}
.rs-party-name {
  margin-top: 7px;
  font-size: 13.5px;
  font-weight: 600;
  color: #141413;
}
.rs-party-line {
  margin-top: 4px;
  font-size: 12.5px;
  color: #3d3a34;
}
/* Addresses are one free-text line the customer typed; it must be allowed to
   wrap rather than run off the paper. */
.rs-party-address { overflow-wrap: break-word; }

.rs-table {
  width: 100%;
  margin-top: 30px;
  border-collapse: collapse;
  table-layout: fixed;
}
.rs-th {
  font-family: var(--font-mono), ui-monospace, monospace;
  font-size: 9px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #8f8a7e;
  text-align: left;
  font-weight: 400;
  padding: 0 0 9px;
  border-bottom: 1px solid #141413;
}
.rs-col-qty { width: 58px; }
.rs-col-unit { width: 104px; }
.rs-col-amount { width: 116px; }

.rs-td {
  padding: 10px 0;
  border-bottom: 1px solid #e6e2d7;
  vertical-align: top;
}
.rs-num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.rs-amount { color: #141413; font-weight: 600; }

/* Never truncated. A receipt has to name the book that was actually bought,
   so the title wraps as far as it needs to and ROW_H carries the cost.

   line-height 1.5, not the 1.35 the rest of the sheet uses: titles are the
   one place Bengali survives the switch to an English document, and Bengali
   needs the taller line box — its ascenders and descenders overflow a 1.35
   box, which is invisible until something clips it. */
.rs-item-title {
  font-family: var(--font-serif), Georgia, serif;
  font-size: 13.5px;
  line-height: 1.5;
  color: #141413;
}
/* No overflow:hidden anywhere in a row, and this is the second time that rule
   earned itself: clipping a line box to get an ellipsis also clips it
   vertically, and Bengali ink overflows the em box it is given, so author
   names came out sliced through the middle. Nothing inside a row is allowed
   to clip — the row grows instead, and ROW_H is what absorbs it. */
.rs-item-authors {
  margin-top: 3px;
  font-size: 10.5px;
  line-height: 1.5;
  color: #8f8a7e;
}

.rs-totals-wrap {
  display: flex;
  justify-content: flex-end;
  margin-top: 22px;
}
.rs-totals {
  width: 320px;
  background: #faf9f5;
  padding: 16px 18px;
}
.rs-total-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 3px 0;
}
.rs-total-label { font-size: 12px; color: #6b665c; }
.rs-total-value {
  font-size: 12.5px;
  color: #141413;
  font-variant-numeric: tabular-nums;
}
.rs-grand {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 16px;
  margin-top: 10px;
  padding-top: 11px;
  border-top: 1px solid #141413;
}
.rs-grand-label {
  font-family: var(--font-mono), ui-monospace, monospace;
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #141413;
}
.rs-grand-value {
  font-family: var(--font-serif), Georgia, serif;
  font-size: 21px;
  color: #c96442;
  font-variant-numeric: tabular-nums;
}

.rs-payment {
  display: flex;
  gap: 40px;
  margin-top: 28px;
  padding-top: 18px;
  border-top: 1px solid #e6e2d7;
}
.rs-payment-status { margin-left: auto; text-align: right; }

/* A ruled box, not a coloured pill: the screen's green-ish affordance has no
   meaning in print, and an outline survives a monochrome printer. */
.rs-stamp {
  display: inline-block;
  margin-top: 7px;
  padding: 4px 10px;
  font-family: var(--font-mono), ui-monospace, monospace;
  font-size: 9.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  border: 1px solid currentColor;
  border-radius: 3px;
}
.rs-stamp-settled { color: #141413; }
.rs-stamp-open { color: #c96442; }
.rs-stamp-void { color: #8f8a7e; }

.rs-footer {
  margin-top: auto;
  padding-top: 16px;
  border-top: 1px solid #e6e2d7;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 24px;
}
.rs-thanks {
  font-family: var(--font-serif), Georgia, serif;
  font-style: italic;
  font-size: 12px;
  color: #6b665c;
}
.rs-pagenum {
  font-family: var(--font-mono), ui-monospace, monospace;
  font-size: 9.5px;
  letter-spacing: 0.08em;
  color: #8f8a7e;
}
`;
