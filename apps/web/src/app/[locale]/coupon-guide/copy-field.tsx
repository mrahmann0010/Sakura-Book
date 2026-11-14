"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * A labelled value with a copy button, for the coupon guide only. Its copy is
 * Bangla and lives here, because the whole guide is a single self-contained
 * page and does not go through the shared translations.
 *
 * If the browser refuses clipboard access, the value is selected instead so
 * the shopper can still copy it by hand.
 */
export function CopyField({
  label,
  value,
  display,
  href,
  mono = false,
}: {
  label: string;
  value: string;
  /** What is shown, when it differs from what is copied. */
  display?: string;
  href?: string;
  mono?: boolean;
}) {
  const valueRef = useRef<HTMLElement>(null);
  const [state, setState] = useState<"idle" | "copied" | "selected">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      const node = valueRef.current;
      if (node) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      setState("selected");
    }
    setTimeout(() => setState("idle"), 2000);
  }

  const valueClass = cn(
    "rounded-control min-w-0 flex-1 basis-56 px-4 py-3 wrap-anywhere",
    mono
      ? "border-clay text-ink border border-dashed font-mono text-lg font-semibold tracking-widest"
      : "bg-tint",
  );

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-caption text-muted">{label}</span>
      <div className="flex flex-wrap gap-2">
        {href ? (
          <a
            ref={(node) => {
              valueRef.current = node;
            }}
            href={href}
            target={href.startsWith("http") ? "_blank" : undefined}
            rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
            className={cn(valueClass, "text-clay hover:text-clay-deep font-semibold")}
          >
            {display ?? value}
          </a>
        ) : (
          <span
            ref={(node) => {
              valueRef.current = node;
            }}
            className={valueClass}
          >
            {display ?? value}
          </span>
        )}
        <Button onClick={() => void copy()} className="min-h-12">
          {state === "copied" ? "কপি হয়েছে ✓" : state === "selected" ? "সিলেক্ট হয়েছে" : "কপি করুন"}
        </Button>
      </div>
    </div>
  );
}
