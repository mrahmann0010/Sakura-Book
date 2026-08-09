"use client";

import { useId, type ReactNode } from "react";

import { fieldHint, fieldLabel } from "@/lib/variants";
import { cn } from "@/lib/utils";

export type FieldFrameProps = {
  /** Mono caps label above the control. Omit for a bare control. */
  label?: ReactNode;
  /** Neutral helper text below. Superseded by `error` when one is present. */
  hint?: ReactNode;
  /** Error copy. States the fix, never just the fault. */
  error?: ReactNode;
  className?: string;
  /**
   * Receives the ids to wire onto the control, so the label and helper text
   * are announced with it.
   */
  children: (ids: { id: string; describedBy?: string }) => ReactNode;
};

/**
 * Label · control · helper. The one place field chrome is composed, so Input,
 * Select, Textarea and any bespoke control share identical spacing and states.
 */
export function FieldFrame({
  label,
  hint,
  error,
  className,
  children,
}: FieldFrameProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const message = error ?? hint;

  return (
    <div className={cn("w-full", className)}>
      {label ? (
        <label htmlFor={id} className={fieldLabel}>
          {label}
        </label>
      ) : null}

      {children({ id, describedBy: message ? messageId : undefined })}

      {message ? (
        <p
          id={messageId}
          className={fieldHint({ tone: error ? "error" : "neutral" })}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

export type FieldProps = Omit<FieldFrameProps, "children"> & {
  children: ReactNode;
};

/**
 * Field chrome around content that is not a single native control — a radio
 * group, a card-number gateway slot, a pair of inputs.
 */
export function Field({ label, hint, error, className, children }: FieldProps) {
  return (
    <div className={cn("w-full", className)}>
      {label ? <p className={fieldLabel}>{label}</p> : null}
      {children}
      {error ?? hint ? (
        <p className={fieldHint({ tone: error ? "error" : "neutral" })}>
          {error ?? hint}
        </p>
      ) : null}
    </div>
  );
}
