import type { ReactNode } from "react";

import {
  badge,
  chip,
  countBadge,
  statusPill,
  type BadgeVariants,
  type ChipVariants,
  type StatusPillVariants,
} from "@/lib/variants";
import { cn, type Variants } from "@/lib/utils";

/* --------------------------------------------------------------------------
   Badge — mono caps metadata. Editor's pick, Last copy, Signed.
   At most one per card; the accent tone is reserved for the editorial flag.
   -------------------------------------------------------------------------- */

export type BadgeProps = Variants<BadgeVariants> & {
  children: ReactNode;
  className?: string;
};

export function Badge({ tone = "neutral", children, className }: BadgeProps) {
  return <span className={cn(badge({ tone }), className)}>{children}</span>;
}

/* --------------------------------------------------------------------------
   StatusPill — order lifecycle. Every state carries its word (principle 03),
   so the colour is never the only signal.
   -------------------------------------------------------------------------- */

export type OrderStatus = NonNullable<StatusPillVariants["status"]>;

const statusLabels: Record<OrderStatus, string> = {
  pending: "Pending",
  paid: "Paid",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export type StatusPillProps = Variants<StatusPillVariants> & {
  /** Overrides the canonical word. Rarely needed — the label is the point. */
  children?: ReactNode;
  className?: string;
};

export function StatusPill({ status = "pending", onTint, children, className }: StatusPillProps) {
  return (
    <span className={cn(statusPill({ status, onTint }), className)}>
      {children ?? statusLabels[status]}
    </span>
  );
}

/* --------------------------------------------------------------------------
   Chip — catalog facets. Rendered as a button so a filter is operable; pass
   `as="span"` for a read-only tag.
   -------------------------------------------------------------------------- */

export type ChipProps = Variants<ChipVariants> & {
  children: ReactNode;
  onClick?: () => void;
  /** A chip with no action is a tag, not a control. */
  as?: "button" | "span";
  className?: string;
};

export function Chip({ active = false, as = "button", onClick, children, className }: ChipProps) {
  if (as === "span") {
    return <span className={cn(chip({ active }), className)}>{children}</span>;
  }

  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(chip({ active }), className)}
    >
      {children}
    </button>
  );
}

/* --------------------------------------------------------------------------
   CountBadge — the cart count. Clay, and the only clay in the header.
   -------------------------------------------------------------------------- */

export function CountBadge({
  count,
  max = 99,
  /** "dot" drops the numeral for a plain indicator — the mobile nav's cart
   *  item, where the pill list is already tight on width. */
  variant = "count",
  className,
}: {
  count: number;
  /** Counts above this render as "99+". */
  max?: number;
  variant?: "count" | "dot";
  className?: string;
}) {
  if (count <= 0) return null;

  if (variant === "dot") {
    return <span aria-hidden className={cn("bg-clay size-1.5 rounded-full", className)} />;
  }

  return <span className={cn(countBadge, className)}>{count > max ? `${max}+` : count}</span>;
}
