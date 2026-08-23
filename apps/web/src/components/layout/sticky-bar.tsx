import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The docked bar the mobile cart and checkout end on (wireframes 1c/1e): the
 * total on one line, the primary action under it.
 *
 * Hidden from `lg` up, where the same numbers and the same button live in the
 * summary rail instead — so both pages render the action twice on purpose, and
 * only ever one of them is visible. That is why the CTA is a slot: the two
 * copies must be the same node, not two buttons that can drift apart.
 */
export function StickyBar({
  label,
  value,
  action,
  breakdown,
  note,
  className,
}: {
  /** "Total". */
  label?: ReactNode;
  /** The figure. */
  value?: ReactNode;
  action: ReactNode;
  /**
   * The rows the total is made of — subtotal, delivery, any waiver — sitting
   * above it behind a hairline.
   *
   * Optional because the cart's bar does not want them: postage there is
   * still an estimate, and the summary rail above it already says so. On
   * checkout the bar is the only money the shopper sees while filling the
   * form, and a lump sum with no delivery line beside it is the thing they
   * scroll back up to check.
   */
  breakdown?: ReactNode;
  /** One quiet line under the button — reassurance, or a cut-off time. */
  note?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-page/95 border-rule sticky bottom-0 z-30 border-t backdrop-blur-[2px] lg:hidden",
        className,
      )}
    >
      <div className="shell py-4">
        {breakdown ? <div className="mb-3 flex flex-col gap-2">{breakdown}</div> : null}

        {label || value ? (
          <div
            className={cn(
              "mb-3 flex items-baseline justify-between gap-5",
              breakdown && "hairline pt-3",
            )}
          >
            <span className="text-13.5 text-secondary">{label}</span>
            <span className="text-17 text-ink font-semibold">{value}</span>
          </div>
        ) : null}

        {action}

        {note ? <p className="text-caption text-secondary mt-2.5 text-center">{note}</p> : null}
      </div>
    </div>
  );
}
