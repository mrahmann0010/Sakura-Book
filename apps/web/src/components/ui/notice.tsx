import type { ReactNode } from "react";

import { notice, type NoticeVariants } from "@/lib/variants";
import { cn, type Variants } from "@/lib/utils";

export type NoticeProps = Variants<NoticeVariants> & {
  children: ReactNode;
  /**
   * The clause that carries the state, set in clay at 600 ahead of the rest —
   * "Payment declined. Check the card number and try again."
   */
  lead?: ReactNode;
  className?: string;
};

/**
 * Inline notice. `info` is the tinted neutral block; `error` is white inside a
 * clay rule. Neither uses an icon — the words carry the state.
 */
export function Notice({ tone = "info", lead, children, className }: NoticeProps) {
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={cn(notice({ tone }), className)}
    >
      {lead ? <strong className="font-semibold text-clay">{lead} </strong> : null}
      {children}
    </div>
  );
}

export type ToastProps = {
  children: ReactNode;
  /** Mono meta on the right — "CART 3". */
  meta?: ReactNode;
  className?: string;
};

/**
 * Ink on cream, radius 10. Presentational only: mounting, timing and stacking
 * belong to whatever toast host the app adopts.
 */
export function Toast({ children, meta, className }: ToastProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(notice({ tone: "toast" }), className)}
    >
      <span>{children}</span>
      {meta ? (
        <span className="font-mono text-10.5 tracking-eyebrow text-muted uppercase">
          {meta}
        </span>
      ) : null}
    </div>
  );
}
