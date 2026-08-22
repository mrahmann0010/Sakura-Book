import type { ReactNode } from "react";

import { timelineConnector, timelineDot, timelineLabel, type TimelineStep } from "@/lib/variants";
import { cn } from "@/lib/utils";

/**
 * The customer-facing lifecycle, collapsed from the real 7-value OrderStatus
 * down to three stages a guest actually cares about: the shop has it, staff
 * have checked it, and it is on its way. Everything past "shipped" (i.e.
 * DELIVERED) still reads as the third, complete step — there is no fourth
 * stage for arrival, just the label swapping from an estimate to "Delivered".
 * A cancelled/refunded order is a StatusPill, not a step here — see
 * `toOrderProgressStep` in track-order-view.tsx.
 */
export const ORDER_PROGRESS_STEPS = ["placed", "verified", "shipped"] as const;

export type OrderProgressStep = (typeof ORDER_PROGRESS_STEPS)[number];

export type OrderProgressProps = {
  status: OrderProgressStep;
  detail?: Partial<Record<OrderProgressStep, ReactNode>>;
  className?: string;
};

const stepLabels: Record<OrderProgressStep, string> = {
  placed: "Order placed",
  verified: "Verified & accepted",
  shipped: "Shipped to courier",
};

function stateOf(step: OrderProgressStep, status: OrderProgressStep): TimelineStep {
  const stepIndex = ORDER_PROGRESS_STEPS.indexOf(step);
  const statusIndex = ORDER_PROGRESS_STEPS.indexOf(status);

  if (stepIndex < statusIndex) return "complete";
  if (stepIndex === statusIndex) return "live";
  return "ahead";
}

export function OrderProgress({ status, detail, className }: OrderProgressProps) {
  return (
    <ol aria-label="Order progress" className={cn("grid grid-cols-3", className)}>
      {ORDER_PROGRESS_STEPS.map((step, index) => {
        const state = stateOf(step, status);
        const isLast = index === ORDER_PROGRESS_STEPS.length - 1;

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
              <span className={timelineLabel({ step: state })}>{stepLabels[step]}</span>
              {detail?.[step] ? (
                <span className="text-caption text-secondary mt-1.5 block">{detail[step]}</span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
