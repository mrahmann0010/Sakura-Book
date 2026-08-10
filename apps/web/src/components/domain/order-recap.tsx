"use client";

import { useState, type ReactNode } from "react";

import { Card } from "@/components/ui";
import { cn } from "@/lib/utils";

import { OrderLine, SummaryCard, SummaryRow } from "./summary-card";
import type { BookSummary } from "./types";

/* --------------------------------------------------------------------------
   OrderRecap — checkout's read-only view of the cart (wireframes 1d/1e).

   Deliberately not the cart's summary rail with the steppers switched off.
   The wireframe is explicit that quantity here is "×n, not editable", and the
   way back to editing is one link ("Edit cart") rather than controls scattered
   down the rail. A `readOnly` flag on the cart rail would have meant a rail
   that renders two different interaction models, which is two components.
   -------------------------------------------------------------------------- */

export type RecapLine = {
  book: BookSummary;
  quantity: number;
  /** Preformatted line total — money is never derived in a component. */
  amount: string;
};

export type RecapRow = {
  key: string;
  label: ReactNode;
  value: ReactNode;
  tone?: "default" | "credit";
};

export type OrderRecapProps = {
  title: ReactNode;
  lines: RecapLine[];
  /** Subtotal, delivery, any waiver — already worded and formatted. */
  rows: RecapRow[];
  totalLabel: ReactNode;
  totalValue: ReactNode;
  /** The way back to the cart. A node, because it is a route link. */
  editAction?: ReactNode;
  /** Quiet line under the lines — "read-only · quantity shown as ×n". */
  note?: ReactNode;
  className?: string;
};

/** The desktop rail: every line visible, nothing editable. */
export function OrderRecap({
  title,
  lines,
  rows,
  totalLabel,
  totalValue,
  editAction,
  note,
  className,
}: OrderRecapProps) {
  return (
    <SummaryCard
      title={
        <span className="flex items-baseline justify-between gap-5">
          {title}
          {editAction ? <span className="text-13 font-sans">{editAction}</span> : null}
        </span>
      }
      className={className}
    >
      <div className="flex flex-col gap-3.5">
        {lines.map((line) => (
          <OrderLine
            key={line.book.id}
            book={line.book}
            quantity={line.quantity}
            amount={line.amount}
          />
        ))}
      </div>

      {note ? <p className="text-10.5 text-muted font-mono">{note}</p> : null}

      <div className="hairline mt-2 flex flex-col gap-3.5 pt-5">
        {rows.map((row) => (
          <SummaryRow key={row.key} label={row.label} value={row.value} tone={row.tone} />
        ))}
      </div>

      <SummaryRow tone="total" label={totalLabel} value={totalValue} />
    </SummaryCard>
  );
}

/**
 * The mobile form of the same recap (wireframe 1e): a one-line bar carrying the
 * total, tapping to reveal the lines.
 *
 * Collapsed-by-default is the point — on a phone the form is the job, and the
 * recap is reassurance the shopper asks for, not something that should push the
 * first field below the fold.
 */
export function CollapsibleOrderRecap({
  summaryLabel,
  totalValue,
  children,
  defaultOpen = false,
  className,
}: {
  /** "3 books · show order" — says what opening will reveal. */
  summaryLabel: ReactNode;
  totalValue: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card padding="none" className={cn("overflow-hidden", className)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="px-card-compact min-h-touch flex w-full items-center justify-between gap-4 py-3.5 text-left"
      >
        <span className="text-13.5 text-secondary flex items-center gap-2.5">
          {summaryLabel}
          <span
            aria-hidden
            className={cn(
              "text-muted text-10 transition-transform duration-150",
              open && "rotate-180",
            )}
          >
            ▾
          </span>
        </span>
        <span className="text-15 text-ink font-semibold">{totalValue}</span>
      </button>

      {open ? <div className="px-card-compact hairline pt-4 pb-5">{children}</div> : null}
    </Card>
  );
}
