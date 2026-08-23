import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * cva's `VariantProps` admits `null` for every variant, which leaks into DOM
 * attributes and index lookups. Component prop types use this instead: same
 * keys, optional, never null.
 */
export type Variants<T> = { [K in keyof T]?: NonNullable<T[K]> };

/** Merge conditional class names, with later Tailwind utilities winning. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * On a touch device, the on-screen keyboard can cover the field a person just
 * tapped — nothing in a plain scrolling layout reserves space for it, so what
 * they're typing ends up hidden below the fold. Nudging the focused field back
 * into view after a short delay — long enough for the keyboard's own resize
 * animation to finish, so the browser measures the field's position against
 * the viewport the keyboard has already shrunk — keeps it visible.
 *
 * Gated on `(pointer: coarse)` rather than running unconditionally: a mouse
 * user has no keyboard to cover anything, and an unrequested scroll on every
 * field focus would just be a nuisance there.
 */
export function scrollFieldIntoView(event: { currentTarget: HTMLElement }) {
  if (typeof window === "undefined" || !window.matchMedia("(pointer: coarse)").matches) return;

  const target = event.currentTarget;
  window.setTimeout(() => target.scrollIntoView({ block: "center", behavior: "smooth" }), 300);
}
