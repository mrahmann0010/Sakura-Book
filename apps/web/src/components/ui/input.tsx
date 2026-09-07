"use client";

import { useState, type ComponentPropsWithoutRef, type KeyboardEvent, type ReactNode } from "react";

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

export type PasswordInputProps = Omit<InputProps, "type"> & {
  /**
   * Whether Caps Lock, while this field has focus, is reported under it.
   *
   * On by default and worth having: it is the single most common reason a
   * correct password is rejected, and the field is the one place on the screen
   * that can say so *before* the attempt rather than after.
   */
  capsLockWarning?: boolean;
};

/**
 * A password field with a reveal control.
 *
 * Typing a password blind is a guess, and the panel is signed into from a shop
 * counter on a phone keyboard as often as from a desk — where the cost of a
 * typo is not one wasted keystroke but a failed attempt against a lockout
 * counter (`ADMIN_MAX_FAILED_LOGINS`). The toggle is what lets someone check
 * before spending one.
 *
 * The `type` swap is the whole mechanism, and it is deliberately *not* a
 * `-webkit-text-security` trick: the input stays a real password field until
 * the person asks otherwise, so password managers still recognise it.
 *
 * Lives here rather than in the one page that needs it because it is field
 * chrome, not page content — it shares `FieldFrame` and the `input` recipe
 * with every other control, which is what keeps its height, radius, border
 * states and error handling from drifting from the field above it.
 */
export function PasswordInput({
  label,
  hint,
  error,
  state,
  capsLockWarning = true,
  className,
  fieldClassName,
  onFocus,
  onKeyUp,
  onKeyDown,
  onBlur,
  ...props
}: PasswordInputProps) {
  const [revealed, setRevealed] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const resolved = error ? "error" : state;

  /* Read from the keyboard event rather than tracked as a key: only a
     KeyboardEvent knows the modifier's *current* state, so this is correct
     even when Caps Lock was already on before the field was ever focused. */
  function readCapsLock(event: KeyboardEvent<HTMLInputElement>) {
    if (capsLockWarning) setCapsLock(event.getModifierState("CapsLock"));
  }

  return (
    <FieldFrame
      label={label}
      hint={error ? hint : (capsLock ? "Caps Lock is on." : hint)}
      error={error}
      className={fieldClassName}
    >
      {({ id, describedBy }) => (
        <span className="relative block">
          <input
            id={id}
            type={revealed ? "text" : "password"}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            /* Room for the toggle, so a long password never runs under it. */
            className={cn(input({ state: resolved }), "pr-12", className)}
            onFocus={(event) => {
              onFocus?.(event);
              scrollFieldIntoView(event);
            }}
            onKeyDown={(event) => {
              onKeyDown?.(event);
              readCapsLock(event);
            }}
            onKeyUp={(event) => {
              onKeyUp?.(event);
              readCapsLock(event);
            }}
            onBlur={(event) => {
              onBlur?.(event);
              setCapsLock(false);
            }}
            {...props}
          />

          {/* A toggle, not two buttons: `aria-pressed` is what tells a screen
              reader the password is currently showing, so the name can stay
              fixed and the icon can carry the state for everyone else. */}
          <button
            type="button"
            onClick={() => setRevealed((shown) => !shown)}
            aria-pressed={revealed}
            aria-controls={id}
            aria-label="Show password"
            title={revealed ? "Hide password" : "Show password"}
            /* Inset by the ring's own offset rather than filling the field:
               flush to the edge, the 2px focus outline drew a box hanging off
               the field's border. Still 44px of target in both directions. */
            className="rounded-control text-muted hover:text-ink absolute inset-y-1 right-1 flex w-11 items-center justify-center transition-colors duration-150"
          >
            {revealed ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        </span>
      )}
    </FieldFrame>
  );
}

/* The select's chevron sets the house style for an icon inside a field: a
   20-box at stroke 1.5 in `currentColor`, so it sits at the weight of the text
   beside it. These two are that, plus a slash for the "hiding" half. */
function FieldIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden
      focusable="false"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function EyeIcon() {
  return (
    <FieldIcon>
      <path d="M1.9 10S5.1 4.8 10 4.8 18.1 10 18.1 10 14.9 15.2 10 15.2 1.9 10 1.9 10Z" />
      <circle cx="10" cy="10" r="2.4" />
    </FieldIcon>
  );
}

function EyeOffIcon() {
  return (
    <FieldIcon>
      <path d="M8.2 5.1A7.6 7.6 0 0 1 10 4.8c4.9 0 8.1 5.2 8.1 5.2a15 15 0 0 1-2.6 3.1M11.8 14.9a7.6 7.6 0 0 1-1.8.3c-4.9 0-8.1-5.2-8.1-5.2a15 15 0 0 1 3.4-3.7" />
      <path d="M8.3 8.3a2.4 2.4 0 0 0 3.4 3.4" />
      <path d="m3.5 3.5 13 13" />
    </FieldIcon>
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
