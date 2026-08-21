import type { ElementType, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Mono caps label — the system's most repeated micro-pattern. Section heads,
 * field labels, card kickers, footer column heads.
 */
export function Eyebrow({
  children,
  as: Tag = "p",
  className,
}: {
  children: ReactNode;
  as?: ElementType;
  className?: string;
}) {
  return <Tag className={cn("eyebrow", className)}>{children}</Tag>;
}

/** The wordmark: 13px, 0.18em, uppercase, 600. */
export function Wordmark({
  children = "Nihonova Books",
  as: Tag = "span",
  className,
}: {
  children?: ReactNode;
  as?: ElementType;
  className?: string;
}) {
  return <Tag className={cn("wordmark", className)}>{children}</Tag>;
}

/** Hairline rule. The system's only divider — there are no shadows. */
export function Divider({ className }: { className?: string }) {
  return <hr className={cn("hairline", className)} />;
}

/**
 * Mono order ID at display size, 0.08em tracking. Used on the confirmation
 * headline block and anywhere an ID has to be read aloud or copied.
 */
export function OrderId({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("text-20 tracking-orderid text-ink font-mono", className)}>{children}</span>
  );
}
