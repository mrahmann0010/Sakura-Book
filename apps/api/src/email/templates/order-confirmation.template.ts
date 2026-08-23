import type { OrderRow } from "../../orders";

/**
 * The order-confirmation email, in Bengali — matching every other
 * customer-facing surface in checkout (see apps/web's `bn/common.json`).
 *
 * Plain string-built HTML, not a template engine: one email, sent from one
 * place, with no designer iterating on it independently of the code. Reaches
 * for a templating layer only once a second transactional email exists and
 * the copy-paste between them starts to hurt.
 */
export function orderConfirmationEmail(order: OrderRow): { subject: string; html: string } {
  const address = order.shippingAddress as { address: string; city: string; region: string };

  const rows = order.items
    .map(
      (item) => `
        <tr>
          <td style="padding:8px 0;border-bottom:1px solid #eee;">
            ${escapeHtml(item.bookTitleSnapshot)}
            <div style="color:#666;font-size:13px;">${item.quantity} কপি</div>
          </td>
          <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;">
            ${formatTaka(item.unitPriceCents * item.quantity)}
          </td>
        </tr>`,
    )
    .join("");

  const firstName = order.customerName.trim().split(/\s+/)[0];

  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a;">
      <p>প্রিয় ${escapeHtml(firstName)},</p>

      <h1 style="font-size:20px;">পেমেন্ট নিশ্চিত হয়েছে</h1>
      <p>আপনার অর্ডার <strong>${escapeHtml(order.orderNumber)}</strong>-এর পেমেন্ট আমরা পেয়েছি। এখন থেকে অর্ডারটি প্রস্তুত করা শুরু হবে।</p>

      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        ${rows}
        <tr>
          <td style="padding:8px 0;">${escapeHtml(bookCountLabel(order.items.reduce((sum, item) => sum + item.quantity, 0)))}</td>
          <td style="padding:8px 0;text-align:right;">${formatTaka(order.subtotalCents)}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;">ডেলিভারি</td>
          <td style="padding:8px 0;text-align:right;">${formatTaka(order.shippingCents)}</td>
        </tr>
        ${
          order.discountCents > 0
            ? `<tr>
                 <td style="padding:8px 0;">ছাড়</td>
                 <td style="padding:8px 0;text-align:right;">−${formatTaka(order.discountCents)}</td>
               </tr>`
            : ""
        }
        <tr>
          <td style="padding:8px 0;font-weight:bold;border-top:1px solid #ccc;">মোট</td>
          <td style="padding:8px 0;text-align:right;font-weight:bold;border-top:1px solid #ccc;">${formatTaka(order.totalCents)}</td>
        </tr>
      </table>

      <p style="margin-top:24px;">
        <strong>ডেলিভারি ঠিকানা</strong><br/>
        ${escapeHtml(order.customerName)}<br/>
        ${escapeHtml(address.address)}, ${escapeHtml(address.city)}, ${escapeHtml(address.region)}<br/>
        ${escapeHtml(order.customerPhone)}
      </p>

      <p style="margin-top:24px;">
        যেকোনো প্রশ্নে এই ইমেইলে রিপ্লাই করুন অথবা লিখুন
        <a href="mailto:info@nihonovaacademy.com" style="color:#1a1a1a;">info@nihonovaacademy.com</a>-এ।
      </p>

      <p>শুভকামনায়,<br/>Nihonova Academy</p>
    </div>`;

  return { subject: `পেমেন্ট নিশ্চিত হয়েছে — অর্ডার ${order.orderNumber}`, html };
}

/**
 * Minor units → "৳১,৪০০", matching apps/web's `formatMoney` in spirit — Bengali
 * digit grouping, no decimals, since every real BDT price in this shop is a
 * whole taka (see CURRENCY's comment in env.schema.ts).
 */
function formatTaka(cents: number): string {
  return new Intl.NumberFormat("bn", {
    style: "currency",
    currency: "BDT",
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/**
 * "৩টি বইয়ের মূল্য" — same phrasing as checkout's `summary.subtotal` (see
 * bn/common.json), which replaced "উপমোট" for the same row: that word is a
 * calque, উপ- ("sub-") bolted onto মোট, mirroring English rather than naming
 * what the row is. Bengali doesn't inflect the noun for plural, so one form
 * covers both counts, same as checkout's `_one`/`_other` pair sharing text.
 */
function bookCountLabel(count: number): string {
  return `${new Intl.NumberFormat("bn").format(count)}টি বইয়ের মূল্য`;
}

/** The only untrusted strings here are customer-entered — name, address, phone. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
