"use client";

import { useId, useState, type ReactNode } from "react";

import { ChevronDownIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/**
 * The docked bar the mobile cart and checkout end on: one row — the total on
 * the left, the primary action on the right.
 *
 * One row, not the stacked total-over-button it used to be: on a phone this
 * bar sits on top of the form being filled in, and stacked (with the
 * checkout breakdown above it) it took up to a third of the screen. Side by
 * side it is ~64px and the button is still a full-height tap target.
 *
 * The breakdown, when given, is folded behind a "details" toggle on the total
 * and opens upward over the page. The payment step already prints the same
 * rows next to the transfer fields, so the bar only has to make them
 * reachable, not always visible.
 *
 * Hidden from `lg` up, where the same numbers and the same button live in the
 * summary rail instead — so both pages render the action twice on purpose,
 * and only ever one of them is visible. That is why the CTA is a slot: the
 * two copies must be the same node, not two buttons that can drift apart.
 */
export function StickyBar({
  label,
  value,
  action,
  breakdown,
  breakdownToggle,
  step,
  note,
  className,
}: {
  /** "Total". */
  label?: ReactNode;
  /** The figure. */
  value?: ReactNode;
  action: ReactNode;
  /** The rows the total is made of, shown on demand above the bar. */
  breakdown?: ReactNode;
  /** Accessible text for the breakdown toggle ("Details"). */
  breakdownToggle?: string;
  /** Where the shopper is, "Step 1 of 2" — a reminder there is little left. */
  step?: ReactNode;
  /** One quiet line under the row — reassurance, or a cut-off time. */
  note?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const showOpen = open && Boolean(breakdown);

  const caption = [step, label].filter(Boolean);

  return (
    <div
      className={cn(
        "bg-page/95 border-rule sticky bottom-0 z-30 border-t backdrop-blur-[2px] lg:hidden",
        className,
      )}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {showOpen ? (
        <div id={panelId} className="shell border-rule flex flex-col gap-2 border-b py-3">
          {breakdown}
        </div>
      ) : null}

      <div className="shell flex items-center gap-4 py-2.5">
        <div className="min-w-0 flex-1">
          {caption.length > 0 ? (
            <p className="text-caption text-secondary truncate">
              {caption.map((part, i) => (
                <span key={i}>
                  {i > 0 ? " · " : null}
                  {part}
                </span>
              ))}
            </p>
          ) : null}
          {value ? (
            breakdown ? (
              <button
                type="button"
                aria-expanded={showOpen}
                aria-controls={panelId}
                onClick={() => setOpen((was) => !was)}
                className="text-17 text-ink flex items-center gap-1.5 font-semibold"
              >
                {value}
                <span className="text-caption text-secondary inline-flex items-center gap-0.5 font-normal">
                  {breakdownToggle}
                  <ChevronDownIcon
                    aria-hidden="true"
                    size={16}
                    className={cn("transition-transform", !showOpen && "rotate-180")}
                  />
                </span>
              </button>
            ) : (
              <p className="text-17 text-ink font-semibold">{value}</p>
            )
          ) : null}
        </div>

        <div className="w-[58%] max-w-72 shrink-0">{action}</div>
      </div>

      {note ? (
        <p className="text-caption text-secondary shell -mt-1 pb-2.5 text-center">{note}</p>
      ) : null}
    </div>
  );
}
