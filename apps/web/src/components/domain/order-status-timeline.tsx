import type { ReactNode } from "react";

import { timelineConnector, timelineDot, timelineLabel, type TimelineStep } from "@/lib/variants";
import { cn } from "@/lib/utils";

/**
 * The four fixed steps. Not configurable: the doc specifies this exact
 * sequence and every reference draws all four, including the ones not reached
 * yet. A cancelled order is a StatusPill, not a fifth step.
 */
export const ORDER_STEPS = ["pending", "paid", "shipped", "delivered"] as const;

export type OrderStep = (typeof ORDER_STEPS)[number];

export type OrderStatusTimelineProps = {
  /** The step the order is currently on. Everything before it reads complete. */
  status: OrderStep;
  /** Optional second line per step — a timestamp, a carrier, an estimate. */
  detail?: Partial<Record<OrderStep, ReactNode>>;
  /**
   * `full` gives each step a bold label and a detail line (the track-order
   * page); `compact` is the label alone (the confirmation strip).
   */
  size?: "full" | "compact";
  className?: string;
};

const stepLabels: Record<OrderStep, string> = {
  pending: "Pending",
  paid: "Paid",
  shipped: "Shipped",
  delivered: "Delivered",
};

function stateOf(step: OrderStep, status: OrderStep): TimelineStep {
  const stepIndex = ORDER_STEPS.indexOf(step);
  const statusIndex = ORDER_STEPS.indexOf(status);

  if (stepIndex < statusIndex) return "complete";
  if (stepIndex === statusIndex) return "live";
  return "ahead";
}

export function OrderStatusTimeline({
  status,
  detail,
  size = "full",
  className,
}: OrderStatusTimelineProps) {
  return (
    <ol aria-label="Order progress" className={cn("grid grid-cols-4", className)}>
      {ORDER_STEPS.map((step, index) => {
        const state = stateOf(step, status);
        const isLast = index === ORDER_STEPS.length - 1;

        return (
          <li
            key={step}
            aria-current={state === "live" ? "step" : undefined}
            className="flex flex-col"
          >
            <span className="flex items-center">
              <span aria-hidden className={timelineDot({ step: state })} />
              {!isLast ? <span aria-hidden className={timelineConnector({ step: state })} /> : null}
            </span>

            <span className="mt-3.5">
              <span
                className={cn(
                  timelineLabel({ step: state }),
                  size === "compact" && "text-caption",
                  /* A completed step in a compact strip drops the bold — only
                     the live step is emphasised there. */
                  size === "compact" && state === "complete" && "font-normal",
                )}
              >
                {stepLabels[step]}
              </span>
              {size === "full" && detail?.[step] ? (
                <span className="text-caption text-secondary mt-1.5 block">{detail[step]}</span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
