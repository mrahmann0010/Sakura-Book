import Link from "next/link";
import type { ReactNode } from "react";

import { progressDot, progressLabel, type ProgressStep } from "@/lib/variants";
import { cn } from "@/lib/utils";

export type CheckoutStep = {
  /** Stable key, and the step's place in the flow. */
  id: string;
  label: ReactNode;
  /** Steps already behind the shopper can be walked back to. */
  href?: string;
};

export type CheckoutProgressProps = {
  steps: CheckoutStep[];
  /** Index of the step the shopper is on. */
  current: number;
  /** Names the whole indicator — "Checkout progress". */
  label: string;
  className?: string;
};

/**
 * Cart → Checkout → Confirmation, as drawn in wireframe 1d.
 *
 * Takes its steps rather than hardcoding three, because the flow gains a step
 * the moment a login or a delivery-slot screen is added. State is derived from
 * `current` alone, so a page cannot mark two steps live.
 *
 * An ordered list with an `aria-current` step, so the progress is available to
 * a screen reader without relying on the dots' colour (principle 03).
 */
export function CheckoutProgress({ steps, current, label, className }: CheckoutProgressProps) {
  return (
    <nav aria-label={label} className={cn("min-w-0", className)}>
      <ol className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
        {steps.map((step, index) => {
          const state: ProgressStep =
            index < current ? "done" : index === current ? "current" : "ahead";
          const isLast = index === steps.length - 1;

          const body = (
            <>
              <span aria-hidden className={progressDot({ step: state })} />
              <span
                className={progressLabel({ step: state })}
                aria-current={state === "current" ? "step" : undefined}
              >
                {step.label}
              </span>
            </>
          );

          return (
            <li key={step.id} className="flex items-center gap-3">
              {/* Only steps already behind the shopper are walkable — a link
                  forward would skip the one they are on. */}
              {state === "done" && step.href ? (
                <Link href={step.href} className="hover:text-clay flex items-center gap-2.5">
                  {body}
                </Link>
              ) : (
                <span className="flex items-center gap-2.5">{body}</span>
              )}

              {!isLast ? <span aria-hidden className="bg-rule h-px w-9" /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
