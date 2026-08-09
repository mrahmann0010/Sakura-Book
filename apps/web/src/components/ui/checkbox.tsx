import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { checkbox, choiceRow } from "@/lib/variants";
import { cn } from "@/lib/utils";

export type CheckboxProps = Omit<
  ComponentPropsWithoutRef<"input">,
  "type" | "children"
> & {
  /** Label sits to the right of the box, 12px away. */
  children?: ReactNode;
  /** Secondary line under the label — delivery prices, caveats. */
  description?: ReactNode;
  className?: string;
};

/**
 * The native input stays in the DOM — checked state, focus and form
 * submission all keep working — and is visually replaced by the drawn box,
 * which follows it via `peer-checked`.
 */
export function Checkbox({
  disabled,
  children,
  description,
  className,
  ...props
}: CheckboxProps) {
  return (
    <label className={cn(choiceRow({ disabled }), className)}>
      <span className="relative inline-flex">
        <input
          type="checkbox"
          disabled={disabled}
          className="peer absolute inset-0 size-full cursor-inherit opacity-0"
          {...props}
        />
        <span aria-hidden className={checkbox}>
          <svg
            viewBox="0 0 12 12"
            className="size-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="square"
          >
            <path d="m2 6 2.5 2.5L10 3" />
          </svg>
        </span>
      </span>

      {children ? (
        <span>
          {children}
          {description ? (
            <span className="block text-caption text-secondary">{description}</span>
          ) : null}
        </span>
      ) : null}
    </label>
  );
}
