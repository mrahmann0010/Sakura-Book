"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type {
  AdminOrderQuery,
  AdminOrderSummary,
  AdminPickList,
  DivisionSlug,
} from "@sakura/contracts";

import { Button } from "@/components/ui";
import { AdminApiError, getAdminPickList, listAdminOrders } from "@/lib/api/admin";
import { bdDivisions } from "@/lib/bd-geo";
import { formatMoney } from "@/lib/money";

/* --------------------------------------------------------------------------
   The paper checklist: every order still to go out, on one printable sheet.

   Opened from the Processing tab with that tab's filters in the URL, so the
   sheet is the list that was on screen — every page of it, not the twenty-five
   rows showing. Printed (or saved as PDF from the print dialog) so a packer can
   work through the parcels with a pen: tick each book as it goes in, tick
   and tick Packed and Shipped.

   The browser's own print rather than a generated file. Customer names,
   addresses and book titles are often Bangla, and printing the page uses the
   fonts it already renders with, so every script prints correctly, the text
   stays selectable in the saved PDF, rows are never cut across pages, and the
   column headings repeat on every page — all things a hand-built PDF would
   have to reimplement.

   The sheet renders twice: once on screen as a preview inside the panel, and
   once portalled straight into <body> for print, where everything else on the
   page is hidden. That keeps the admin rail and buttons off the paper without
   this page knowing how the shell is built.
   -------------------------------------------------------------------------- */

const STATUSES = ["PAYMENT_CONFIRMED", "PROCESSING"] as const;

/** 100 per request, the API's ceiling; 50 requests is 5,000 orders. */
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

type Filters = Pick<AdminOrderQuery, "division" | "q" | "placedFrom" | "placedTo">;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The Processing tab's filters, read back off the URL.
 *
 * Each one is checked before it is sent: a hand-edited link with a bad value
 * should print the wider list, not fail with an API validation error.
 */
function filtersFromUrl(): Filters {
  if (typeof window === "undefined") return {};

  const params = new URLSearchParams(window.location.search);
  const division = params.get("division");
  const q = params.get("q")?.trim();
  const placedFrom = params.get("placedFrom");
  const placedTo = params.get("placedTo");

  return {
    division: bdDivisions.some((d) => d.value === division)
      ? (division as DivisionSlug)
      : undefined,
    q: q ? q.slice(0, 120) : undefined,
    placedFrom: placedFrom && ISO_DAY.test(placedFrom) ? placedFrom : undefined,
    placedTo: placedTo && ISO_DAY.test(placedTo) ? placedTo : undefined,
  };
}

/** Every matching order, oldest first, fetched a page at a time. */
async function fetchAll(filters: Filters): Promise<{ items: AdminOrderSummary[]; total: number }> {
  const items: AdminOrderSummary[] = [];
  let total = 0;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const list = await listAdminOrders({
      ...filters,
      status: [...STATUSES],
      sort: "oldest",
      page,
      pageSize: PAGE_SIZE,
    });

    items.push(...list.items);
    total = list.total;
    if (page >= list.totalPages) break;
  }

  return { items, total };
}

type Sheet = {
  filters: Filters;
  orders: AdminOrderSummary[];
  total: number;
  pickList: AdminPickList;
  generatedAt: Date;
};

export default function ProcessingChecklistPage() {
  const { locale } = useParams<{ locale: string }>();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const filters = filtersFromUrl();

    Promise.all([fetchAll(filters), getAdminPickList({ ...filters, status: [...STATUSES] })])
      .then(([{ items, total }, pickList]) => {
        if (cancelled) return;
        setSheet({ filters, orders: items, total, pickList, generatedAt: new Date() });
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof AdminApiError ? err.message : "Could not load the orders.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-6">
      {/* Landscape: the books column needs the width, and a portrait page
            squeezes titles onto three lines. Everything but the portalled
            sheet is taken out of the printed page. */}
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 10mm; }
          body > *:not(.processing-checklist) { display: none !important; }
          body { background: #fff !important; }
        }
      `}</style>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h2 text-ink font-serif">Processing checklist</h1>
          <p className="text-13.5 text-secondary mt-1">
            {sheet
              ? `${sheet.orders.length} ${sheet.orders.length === 1 ? "order" : "orders"}, ${sheet.pickList.totalCopies} ${sheet.pickList.totalCopies === 1 ? "copy" : "copies"}. Print it, or choose “Save as PDF” in the print dialog.`
              : "Loading every order on the Processing tab…"}
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            href={`/${locale}/admin/accepted-orders`}
            className="text-13.5 text-clay hover:text-clay-deep self-center"
          >
            Back to Processing
          </Link>
          <Button type="button" disabled={!sheet} onClick={() => window.print()}>
            Print / Save as PDF
          </Button>
        </div>
      </div>

      {error ? <p className="text-13.5 text-clay-deep">{error}</p> : null}

      {sheet && sheet.total > sheet.orders.length ? (
        <p className="text-13.5 text-clay-deep">
          This sheet holds the oldest {sheet.orders.length} of {sheet.total} orders. Narrow the
          Processing tab by division or date to print the rest.
        </p>
      ) : null}

      {sheet ? (
        <>
          {/* The on-screen preview, on a white page whatever the theme. */}
          <div className="rounded-container border-rule overflow-x-auto border bg-white">
            <div className="min-w-[1000px] p-8">
              <ChecklistSheet sheet={sheet} />
            </div>
          </div>
          <PrintCopy sheet={sheet} />
        </>
      ) : null}
    </div>
  );
}

/** The copy that prints: portalled to <body> and only shown on paper. */
function PrintCopy({ sheet }: { sheet: Sheet }) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="processing-checklist hidden bg-white print:block">
      <ChecklistSheet sheet={sheet} />
    </div>,
    document.body,
  );
}

/* --------------------------------------------------------------------------
   The sheet itself. Plain black on white: it is read under a packing-table
   light and may come off a monochrome printer, so nothing relies on colour.
   -------------------------------------------------------------------------- */

function ChecklistSheet({ sheet }: { sheet: Sheet }) {
  const { filters, orders, pickList, generatedAt } = sheet;
  const divisionLabel = bdDivisions.find((d) => d.value === filters.division)?.label;
  const toPack = orders.filter((order) => order.status === "PAYMENT_CONFIRMED").length;

  const scope = [
    divisionLabel ? `${divisionLabel} division` : "All divisions",
    filters.placedFrom && filters.placedTo
      ? filters.placedFrom === filters.placedTo
        ? `placed ${filters.placedFrom}`
        : `placed ${filters.placedFrom} to ${filters.placedTo}`
      : "all dates",
    filters.q ? `search “${filters.q}”` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="font-sans text-[12px] leading-snug text-black">
      <header className="flex items-end justify-between gap-6 border-b-2 border-black pb-2">
        <div>
          <p className="text-[18px] font-semibold">Processing checklist</p>
          <p>{scope}</p>
        </div>
        <div className="text-right">
          <p>
            <span className="font-semibold">{orders.length}</span> orders ·{" "}
            <span className="font-semibold">{pickList.totalCopies}</span> copies ·{" "}
            <span className="font-semibold">{toPack}</span> still to pack
          </p>
          <p>Printed {generatedAt.toLocaleString()}</p>
        </div>
      </header>

      {/* What to take off the shelf, ticked as it is picked. */}
      <section className="mt-4 break-inside-avoid">
        <p className="mb-1 text-[13px] font-semibold">Pick list</p>
        <div className="grid grid-cols-2 gap-x-8 lg:grid-cols-3 print:grid-cols-3">
          {pickList.entries.map((entry) => (
            <div
              key={`${entry.bookId ?? "removed"}-${entry.title}`}
              className="flex items-baseline gap-2 border-b border-black/30 py-1"
            >
              <Box />
              <span className="flex-1">{entry.title}</span>
              <span className="font-mono font-semibold">×{entry.copies}</span>
            </div>
          ))}
        </div>
      </section>

      <table className="mt-5 w-full border-collapse">
        {/* A <thead> repeats at the top of every printed page by default. */}
        <thead>
          <tr className="border-y-2 border-black text-left align-bottom">
            <th className="w-7 py-1.5 pr-2 font-semibold">#</th>
            <th className="py-1.5 pr-3 font-semibold">Order</th>
            <th className="py-1.5 pr-3 font-semibold">Customer</th>
            <th className="py-1.5 pr-3 font-semibold">Books (tick as packed)</th>
            <th className="py-1.5 pr-3 text-right font-semibold">Copies</th>
            <th className="py-1.5 pr-3 text-right font-semibold">Collect</th>
            <th className="py-1.5 pr-3 text-center font-semibold">Packed</th>
            <th className="py-1.5 text-center font-semibold">Shipped</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order, index) => (
            <tr
              key={order.orderNumber}
              className="break-inside-avoid border-b border-black/40 align-top"
            >
              <td className="py-2 pr-2 tabular-nums">{index + 1}</td>
              <td className="py-2 pr-3">
                <p className="font-mono font-semibold">{order.orderNumber}</p>
                <p className="text-[11px]">{new Date(order.placedAt).toLocaleDateString()}</p>
                {/* Already ticked on the Packing screen. Printed so the sheet
                      and the system agree about which boxes are still open. */}
                {order.status === "PROCESSING" ? (
                  <p className="text-[11px] font-semibold">Packed in system</p>
                ) : null}
                {order.hasInternalNote ? (
                  <p className="text-[11px] italic">See note in the order</p>
                ) : null}
              </td>
              <td className="py-2 pr-3">
                <p className="font-semibold">{order.customerName}</p>
                <p className="tabular-nums">{order.customerPhone}</p>
              </td>
              <td className="py-2 pr-3">
                <ul className="flex flex-col gap-0.5">
                  {order.lines.map((line, lineIndex) => (
                    <li
                      key={`${line.bookId ?? "removed"}-${lineIndex}`}
                      className="flex items-baseline gap-2"
                    >
                      <Box />
                      <span className="flex-1">{line.title}</span>
                      {/* Bold when more than one: "×2" read as "×1" is how a
                            parcel goes out a book short. */}
                      <span className={`font-mono ${line.quantity > 1 ? "font-bold" : ""}`}>
                        ×{line.quantity}
                      </span>
                    </li>
                  ))}
                </ul>
              </td>
              <td className="py-2 pr-3 text-right font-mono tabular-nums">{order.itemCount}</td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {order.paymentMethod === "cash-on-delivery"
                  ? formatMoney(order.totalCents, "en-GB", order.currency)
                  : "Paid"}
              </td>
              <td className="py-2 pr-3 text-center">
                <Box large checked={order.status === "PROCESSING"} />
              </td>
              <td className="py-2 text-center">
                <Box large />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {orders.length === 0 ? (
        <p className="py-6 text-center">No orders on the Processing tab for these filters.</p>
      ) : null}

      <footer className="mt-8 grid break-inside-avoid grid-cols-3 gap-10">
        {["Packed by", "Checked by", "Handed to courier"].map((label) => (
          <div key={label}>
            <span className="block h-8 border-b border-black" />
            <p className="mt-1">{label} · name, signature, date</p>
          </div>
        ))}
      </footer>
    </div>
  );
}

/** An empty square to tick with a pen. Pre-ticked only for facts already recorded. */
function Box({ large = false, checked = false }: { large?: boolean; checked?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center border border-black align-middle leading-none ${
        large ? "size-5 text-[14px]" : "size-3.5 text-[10px]"
      }`}
    >
      {checked ? "✓" : ""}
    </span>
  );
}
