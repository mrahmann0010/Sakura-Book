"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { timelineConnector, timelineDot, timelineLabel, type TimelineStep } from "@/lib/variants";
import { cn } from "@/lib/utils";

/**
 * The customer-facing lifecycle, collapsed from the real 7-value OrderStatus
 * down to the stages a guest actually cares about: the shop has it, the money
 * has been checked, it is boxed, and it is on its way. Everything past
 * "shipped" (i.e. DELIVERED) still reads as the last, complete step — there is
 * no separate stage for arrival, just the label swapping from an estimate to
 * "Delivered". A cancelled/refunded order is a StatusPill, not a step here —
 * see `toOrderProgressStep` in orders/order-detail-card.tsx.
 *
 * `packed` (PROCESSING) used to be folded into `verified`, which left the bar
 * identical the moment payment cleared and the moment the parcel was boxed —
 * and "is it packed yet" is the question people reopen this page to ask. It is
 * its own stage for that reason alone.
 */
export const ORDER_PROGRESS_STEPS = ["placed", "verified", "packed", "shipped"] as const;

export type OrderProgressStep = (typeof ORDER_PROGRESS_STEPS)[number];

export type OrderProgressProps = {
  status: OrderProgressStep;
  detail?: Partial<Record<OrderProgressStep, ReactNode>>;
  /**
   * `horizontal` is the strip on a confirmation card — four short labels, no
   * detail lines worth reading. `vertical` stacks them so each stage can carry
   * its timestamp, which is what the tracking page is for and what four
   * columns on a 360px phone cannot hold.
   */
  orientation?: "horizontal" | "vertical";
  className?: string;
};

function stateOf(step: OrderProgressStep, status: OrderProgressStep): TimelineStep {
  const stepIndex = ORDER_PROGRESS_STEPS.indexOf(step);
  const statusIndex = ORDER_PROGRESS_STEPS.indexOf(status);

  if (stepIndex < statusIndex) return "complete";
  if (stepIndex === statusIndex) return "live";
  return "ahead";
}

export function OrderProgress({
  status,
  detail,
  orientation = "horizontal",
  className,
}: OrderProgressProps) {
  const { t } = useTranslation();
  const vertical = orientation === "vertical";

  return (
    <ol
      aria-label={t("orders.progress.label")}
      className={cn(vertical ? "flex flex-col" : "grid grid-cols-4", className)}
    >
      {ORDER_PROGRESS_STEPS.map((step, index) => {
        const state = stateOf(step, status);
        const isLast = index === ORDER_PROGRESS_STEPS.length - 1;

        return (
          <li
            key={step}
            aria-current={state === "live" ? "step" : undefined}
            className={cn("flex", vertical ? "gap-3.5" : "flex-col")}
          >
            {/* Horizontal runs the connector to the right of the dot; vertical
                runs it underneath, and the column has to keep its height even
                on a short label, hence min-h on the last-but-one rail. */}
            <span
              className={cn(
                "flex items-center",
                vertical && "min-h-11 flex-col pt-1",
                vertical && isLast && "min-h-0",
              )}
            >
              <span aria-hidden className={timelineDot({ step: state })} />
              {!isLast ? (
                <span aria-hidden className={timelineConnector({ step: state, orientation })} />
              ) : null}
            </span>

            <span className={cn(vertical ? "flex-1 pb-5" : "mt-3.5", isLast && vertical && "pb-0")}>
              <span className={timelineLabel({ step: state })}>{t(`orders.progress.${step}`)}</span>
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
