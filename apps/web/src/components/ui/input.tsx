"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { input, type InputVariants } from "@/lib/variants";
import { cn, scrollFieldIntoView, type Variants } from "@/lib/utils";

import { FieldFrame } from "./field";

type FieldChrome = {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Class for the outer field wrapper; `className` styles the control. */
  fieldClassName?: string;
};

export type InputProps = Omit<ComponentPropsWithoutRef<"input">, "size"> &
  Omit<Variants<InputVariants>, "select"> &
  FieldChrome;

export function Input({
  label,
  hint,
  error,
  state,
  className,
  fieldClassName,
  onFocus,
  ...props
}: InputProps) {
  /* An error always wins over whatever state was passed. */
  const resolved = error ? "error" : state;

  return (
    <FieldFrame label={label} hint={hint} error={error} className={fieldClassName}>
      {({ id, describedBy }) => (
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={cn(input({ state: resolved }), className)}
          onFocus={(event) => {
            onFocus?.(event);
            scrollFieldIntoView(event);
          }}
          {...props}
        />
      )}
    </FieldFrame>
  );
}

export type TextareaProps = ComponentPropsWithoutRef<"textarea"> &
  Omit<Variants<InputVariants>, "select"> &
  FieldChrome;

export function Textarea({
  label,
  hint,
  error,
  state,
  rows = 4,
  className,
  fieldClassName,
  onFocus,
  ...props
}: TextareaProps) {
  const resolved = error ? "error" : state;

  return (
    <FieldFrame label={label} hint={hint} error={error} className={fieldClassName}>
      {({ id, describedBy }) => (
        <textarea
          id={id}
          rows={rows}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={cn(input({ state: resolved }), "resize-y", className)}
          onFocus={(event) => {
            onFocus?.(event);
            scrollFieldIntoView(event);
          }}
          {...props}
        />
      )}
    </FieldFrame>
  );
}
