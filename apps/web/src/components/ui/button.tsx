import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { button, type ButtonVariants } from "@/lib/variants";
import { cn, type Variants } from "@/lib/utils";

import { Spinner } from "./spinner";

export type ButtonProps = Omit<ComponentPropsWithoutRef<"button">, "children"> &
  Omit<Variants<ButtonVariants>, "loading"> & {
    children?: ReactNode;
    /** Icon slot before the label. Never the only content — icons are always labelled. */
    leading?: ReactNode;
    /** Icon slot after the label. */
    trailing?: ReactNode;
    /**
     * Swaps the leading slot for a spinner and disables the button. Pass
     * `loadingLabel` to change the word too — the reference shows
     * "Add to cart" becoming "Adding".
     */
    loading?: boolean;
    loadingLabel?: ReactNode;
  };

export function Button({
  variant = "primary",
  size = "md",
  block,
  loading = false,
  loadingLabel,
  leading,
  trailing,
  disabled,
  className,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(button({ variant, size, block, loading }), className)}
      {...props}
    >
      {loading ? (
        <Spinner size="inline" tone={variant === "primary" ? "onAccent" : "default"} />
      ) : (
        leading
      )}
      {loading ? (loadingLabel ?? children) : children}
      {!loading && trailing}
    </button>
  );
}

/**
 * A link that looks like a button. Kept separate rather than an `as` prop so
 * anchors never inherit `disabled`, which does nothing on an <a>.
 */
export type LinkButtonProps = ComponentPropsWithoutRef<"a"> & Variants<ButtonVariants>;

export function LinkButton({
  variant = "primary",
  size = "md",
  block,
  className,
  children,
  ...props
}: LinkButtonProps) {
  return (
    <a className={cn(button({ variant, size, block }), className)} {...props}>
      {children}
    </a>
  );
}
