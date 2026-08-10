"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { card } from "@/lib/variants";
import { cn } from "@/lib/utils";

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  /** Lora title. Also names the dialog for assistive tech. */
  title: ReactNode;
  /** One sentence of consequence. */
  description?: ReactNode;
  /** Buttons: primary first, ghost second, 12px apart. */
  actions?: ReactNode;
  /** Anything richer than description — a form, a list. */
  children?: ReactNode;
  size?: "sm" | "md";
  className?: string;
};

/**
 * The modal is the same card, centred on a dimmed page. No animation: the
 * motion budget spends nothing on navigation (principle 04).
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  actions,
  children,
  size = "sm",
  className,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const widths = { sm: "max-w-measure-lede", md: "max-w-measure" } as const;

  return (
    <div
      className="bg-overlay p-page-mobile fixed inset-0 z-50 flex items-center justify-center"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        tabIndex={-1}
        className={cn(
          card({ variant: "modal", padding: "roomy" }),
          "w-full outline-none",
          widths[size],
          className,
        )}
      >
        <h2 className="text-24 text-ink font-serif leading-tight">{title}</h2>

        {description ? (
          <p className="text-13.5 text-body mt-3.5 leading-relaxed">{description}</p>
        ) : null}

        {children ? <div className="mt-5">{children}</div> : null}

        {actions ? (
          <div className="mt-card-roomy flex flex-wrap items-center gap-3">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}
