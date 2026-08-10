import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { iconButton, type IconButtonVariants } from "@/lib/variants";
import { cn, type Variants } from "@/lib/utils";

export type IconButtonProps = Omit<ComponentPropsWithoutRef<"button">, "children"> &
  Variants<IconButtonVariants> & {
    /** A 20px icon. Stroke 1.5, square caps — see §8. */
    children: ReactNode;
    /** Required: an icon on its own is never self-describing. */
    label: string;
  };

export function IconButton({
  variant = "outline",
  size = "md",
  label,
  className,
  children,
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(iconButton({ variant, size }), className)}
      {...props}
    >
      {children}
    </button>
  );
}
