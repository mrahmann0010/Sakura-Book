import type { ReactNode } from "react";

import { Card } from "@/components/ui";
import { cn } from "@/lib/utils";

export type EmptyStateProps = {
  /** Mono caps kicker naming the context — CART, SEARCH, ORDER LOOKUP. */
  eyebrow?: ReactNode;
  /** One line in Lora. Says what is empty, in the user's words. */
  title: ReactNode;
  /** One sentence of help. Points at the way out. */
  description?: ReactNode;
  /**
   * Exactly one action. A node rather than label + onClick because the three
   * references are two links and a button.
   */
  action?: ReactNode;
  className?: string;
};

/**
 * Tinted card, 40/32 padding, no illustration — the doc is explicit about
 * that. Serves empty, no-results and not-found alike; the difference between
 * them is entirely copy, which is the point.
 */
export function EmptyState({
  eyebrow,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <Card
      variant="tint"
      padding="none"
      as="section"
      className={cn("px-8 py-10", className)}
    >
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h2 className="mt-4.5 font-serif text-26 leading-tight text-ink">{title}</h2>
      {description ? (
        <p className="mt-3 max-w-measure-lede text-13.5 leading-relaxed text-body">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-6.5">{action}</div> : null}
    </Card>
  );
}
