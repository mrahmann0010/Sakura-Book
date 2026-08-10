import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { choiceRow, radio } from "@/lib/variants";
import { cn } from "@/lib/utils";

export type RadioProps = Omit<ComponentPropsWithoutRef<"input">, "type" | "children"> & {
  children?: ReactNode;
  description?: ReactNode;
  className?: string;
};

export function Radio({ disabled, children, description, className, ...props }: RadioProps) {
  return (
    <label className={cn(choiceRow({ disabled }), className)}>
      <span className="relative inline-flex">
        <input
          type="radio"
          disabled={disabled}
          className="peer cursor-inherit absolute inset-0 size-full opacity-0"
          {...props}
        />
        <span aria-hidden className={radio} />
      </span>

      {children ? (
        <span>
          {children}
          {description ? (
            <span className="text-caption text-secondary block">{description}</span>
          ) : null}
        </span>
      ) : null}
    </label>
  );
}

export type RadioGroupProps = {
  /** Shared name — what makes the radios mutually exclusive. */
  name: string;
  /** Accessible group label, rendered as a mono caps legend when given. */
  label?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** Stacked group with the 12px rhythm the checkout uses. */
export function RadioGroup({ name, label, children, className }: RadioGroupProps) {
  return (
    <fieldset className={cn("min-w-0", className)} name={name}>
      {label ? <legend className="eyebrow mb-3">{label}</legend> : null}
      <div className="flex flex-col gap-3">{children}</div>
    </fieldset>
  );
}
