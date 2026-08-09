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
