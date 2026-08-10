import type { ReactNode } from "react";

import { paymentOption, radio } from "@/lib/variants";
import { cn } from "@/lib/utils";

/* --------------------------------------------------------------------------
   PaymentOption — the radio-in-a-card of wireframes 1d/1e.

   Not a variant of `Radio`: that one is a row in a stack, this one is a card
   that can expand to hold its own fields, and the difference is structural. It
   still drives its mark off the native input's `:checked` state through the
   same `radio` recipe, so the two controls can never look out of step.

   `fields` is a slot rather than a prop-described form, because what a method
   needs is the method's business — a transfer wants a sender number and a
   transaction ID, a gateway will want an iframe.
   -------------------------------------------------------------------------- */

export type PaymentOptionProps = {
  /** Shared radio name across the group. */
  name: string;
  value: string;
  checked: boolean;
  onSelect?: (value: string) => void;
  label: ReactNode;
  /** Mono note on the right — "cash on delivery", "card / gateway · later". */
  meta?: ReactNode;
  /** One line under the label. */
  description?: ReactNode;
  /** Revealed only while this option is selected. */
  fields?: ReactNode;
  /** Drawn, unavailable, and saying so — never silently missing. */
  disabled?: boolean;
  className?: string;
};

export function PaymentOption({
  name,
  value,
  checked,
  onSelect,
  label,
  meta,
  description,
  fields,
  disabled = false,
  className,
}: PaymentOptionProps) {
  return (
    <div className={cn(paymentOption({ selected: checked && !disabled, disabled }), className)}>
      <label
        className={cn(
          "flex items-center gap-3",
          disabled ? "cursor-not-allowed" : "cursor-pointer",
        )}
      >
        <span className="relative inline-flex">
          <input
            type="radio"
            name={name}
            value={value}
            checked={checked}
            disabled={disabled}
            onChange={() => onSelect?.(value)}
            className="peer cursor-inherit absolute inset-0 size-full opacity-0"
          />
          <span aria-hidden className={radio} />
        </span>

        <span className="min-w-0 flex-1">
          <span className={cn("text-body block", disabled ? "text-muted" : "text-ink")}>
            {label}
          </span>
          {description ? (
            <span className="text-caption text-secondary mt-1 block">{description}</span>
          ) : null}
        </span>

        {meta ? <span className="eyebrow shrink-0 normal-case">{meta}</span> : null}
      </label>

      {/* Expands only when selected — the wireframe is explicit about that. */}
      {fields && checked && !disabled ? <div className="mt-3.5 pl-7.5">{fields}</div> : null}
    </div>
  );
}

/** The stacked group. `radiogroup` so the set is announced as one control. */
export function PaymentOptionList({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex flex-col gap-2.5", className)}>
      {children}
    </div>
  );
}
