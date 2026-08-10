import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

import { card, type CardVariants } from "@/lib/variants";
import { cn, type Variants } from "@/lib/utils";

export type CardProps = ComponentPropsWithoutRef<"div"> &
  Variants<CardVariants> & {
    /** `section`, `article`, `aside` — whatever the context calls for. */
    as?: ElementType;
  };

/**
 * The system has exactly one card: white, 1px rule, 12px radius. `tint` is the
 * same shape without the border, for sections and summaries — and it never
 * nests inside another tinted block. `modal` is the cream panel.
 *
 * Deliberately a shell that takes arbitrary children rather than a
 * title/body/footer API: the references compose cards very differently
 * (summary rows, address blocks, buy rails) and a fixed shape would fight all
 * three. Use `CardTitle` and `CardDivider` for the recurring bits.
 */
export function Card({
  as: Tag = "div",
  variant = "surface",
  padding = "md",
  className,
  children,
  ...props
}: CardProps) {
  return (
    <Tag className={cn(card({ variant, padding }), className)} {...props}>
      {children}
    </Tag>
  );
}

/** Lora title inside a card. 22px in a surface card, 24px on a summary. */
export function CardTitle({
  children,
  size = "md",
  className,
  as: Tag = "h2",
}: {
  children: ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
  as?: ElementType;
}) {
  const sizes = {
    sm: "text-20",
    md: "text-22",
    lg: "text-24",
  } as const;

  return (
    <Tag className={cn("text-ink font-serif leading-tight", sizes[size], className)}>
      {children}
    </Tag>
  );
}

/**
 * Internal divider: a top hairline with matched space above and below. The
 * references always use 20–22px, so it is a single treatment, not a variant.
 */
export function CardDivider({ className }: { className?: string }) {
  return <hr className={cn("hairline my-card-compact", className)} />;
}
