"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { input, optionItem, optionList, type InputVariants } from "@/lib/variants";
import { cn, type Variants } from "@/lib/utils";

import { FieldFrame } from "./field";

export type SelectOption = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};

export type SelectProps = Omit<ComponentPropsWithoutRef<"select">, "children"> &
  Omit<Variants<InputVariants>, "select"> & {
    label?: ReactNode;
    hint?: ReactNode;
    error?: ReactNode;
    fieldClassName?: string;
    /** Data-driven options, or pass `children` for grouped markup. */
    options?: SelectOption[];
    children?: ReactNode;
  };

export function Select({
  label,
  hint,
  error,
  state,
  options,
  children,
  className,
  fieldClassName,
  ...props
}: SelectProps) {
  const resolved = error ? "error" : state;

  return (
    <FieldFrame
      label={label}
      hint={hint}
      error={error}
      className={fieldClassName}
    >
      {({ id, describedBy }) => (
        <span className="relative block">
          <select
            id={id}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            className={cn(input({ state: resolved, select: true }), className)}
            {...props}
          >
            {options
              ? options.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                  >
                    {typeof option.label === "string" ? option.label : option.value}
                  </option>
                ))
              : children}
          </select>
          <svg
            viewBox="0 0 20 20"
            aria-hidden
            className="pointer-events-none absolute top-1/2 right-field-x size-5 -translate-y-1/2 text-muted"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="m5 8 5 5 5-5" />
          </svg>
        </span>
      )}
    </FieldFrame>
  );
}

/* --------------------------------------------------------------------------
   OptionList — the open menu drawn in Foundations. Presentational: use it for
   a custom listbox or a sort popover; the native <Select> above covers the
   closed state.
   -------------------------------------------------------------------------- */

export type OptionListProps = {
  options: SelectOption[];
  value?: string;
  onSelect?: (value: string) => void;
  className?: string;
  /** Accessible name for the list. */
  label?: string;
};

export function OptionList({
  options,
  value,
  onSelect,
  label,
  className,
}: OptionListProps) {
  return (
    <ul role="listbox" aria-label={label} className={cn(optionList, className)}>
      {options.map((option) => (
        <li key={option.value} role="option" aria-selected={option.value === value}>
          <button
            type="button"
            disabled={option.disabled}
            onClick={() => onSelect?.(option.value)}
            className={cn(
              optionItem({ selected: option.value === value }),
              option.disabled && "text-muted pointer-events-none",
            )}
          >
            {option.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
