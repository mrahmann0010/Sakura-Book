import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";

import { Card, CardTitle } from "@/components/ui";
import { cn, type Variants } from "@/lib/utils";

import { BookCover } from "./book-cover";
import type { BookSummary } from "./types";

/* --------------------------------------------------------------------------
   The money rail. Cart summary, checkout order summary and the confirmation
   totals are the same tinted card with different rows — so this is a shell
   plus three row primitives, not three components.
   -------------------------------------------------------------------------- */

export function SummaryCard({
  title,
  children,
  footer,
  className,
}: {
  title: ReactNode;
  children: ReactNode;
  /** The primary action and its reassurance line. */
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <Card variant="tint" padding="roomy" as="section" className={className}>
      <CardTitle size="lg">{title}</CardTitle>
      <div className="text-13.5 mt-5.5 flex flex-col gap-3.5">{children}</div>
      {footer}
    </Card>
  );
}

const summaryRow = cva("flex items-baseline justify-between gap-5 text-13.5", {
  variants: {
    tone: {
      /** Subtotal, delivery — the label is quiet, the figure is not. */
      default: "",
      /** A discount or waived charge. The one accent on the rail. */
      credit: "text-clay",
      /** The total, above a hairline. */
      total: "hairline mt-5.5 pt-5.5 text-ink",
    },
  },
  defaultVariants: { tone: "default" },
});

export type SummaryRowProps = Variants<VariantProps<typeof summaryRow>> & {
  label: ReactNode;
  value: ReactNode;
  className?: string;
};

export function SummaryRow({ label, value, tone = "default", className }: SummaryRowProps) {
  return (
    <div className={cn(summaryRow({ tone }), className)}>
      <span className={tone === "default" ? "text-secondary" : undefined}>{label}</span>
      <span className={tone === "default" ? "text-ink" : undefined}>{value}</span>
    </div>
  );
}

export type OrderLineProps = {
  book: BookSummary;
  quantity?: number;
  /** Preformatted line total. */
  amount: ReactNode;
  /**
   * Thumbnail rung: `xs` for the checkout rail (40px), `md` for the
   * confirmation list (56px). Radius follows size.
   */
  size?: "xs" | "md";
  className?: string;
};

/**
 * A read-only book line: thumbnail, title (× quantity), amount. Used in the
 * checkout rail and the confirmation list — nowhere the quantity can change,
 * which is exactly what separates it from CartItem.
 */
export function OrderLine({ book, quantity, amount, size = "xs", className }: OrderLineProps) {
  const isSmall = size === "xs";

  return (
    <div
      className={cn(
        isSmall ? "grid-line-xs gap-3.5" : "grid-line-md gap-5 py-5",
        "items-center",
        !isSmall && "border-rule border-b",
        className,
      )}
    >
      <BookCover src={book.coverUrl} title={book.title} author={book.author} radius="xs" />
      <p
        className={cn(
          "min-w-0 truncate",
          isSmall ? "text-13 text-ink" : "text-17 text-ink font-serif",
        )}
      >
        {book.title}
        {quantity ? ` × ${quantity}` : null}
      </p>
      <p className={isSmall ? "text-13" : "text-13.5"}>{amount}</p>
    </div>
  );
}
