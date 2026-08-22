"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";

export type CopyButtonProps = {
  value: string;
  className?: string;
};

/**
 * Copy-to-clipboard, with a 1.8s "copied" swap. Extracted from the mobile-
 * money payment step (its `CopyButton`) once the checkout confirmation screen
 * needed the same behaviour for the order ID — two call sites is what earns
 * the shared component.
 */
export function CopyButton({ value, className }: CopyButtonProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can be denied by the browser; the value is still
      // selectable text, so there is nothing to recover from here.
    }
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className={`text-caption text-clay hover:text-clay-deep inline-flex shrink-0 items-center gap-1.5 font-semibold ${className ?? ""}`}
    >
      {copied ? (
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path
            d="M4 10.5l3.5 3.5L16 5.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden>
          <rect x="7" y="7" width="9.5" height="9.5" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M13 6.5V4.75A1.25 1.25 0 0 0 11.75 3.5h-7A1.25 1.25 0 0 0 3.5 4.75v7c0 .69.56 1.25 1.25 1.25H6.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      )}
      {copied ? t("checkout.payment.copied") : t("checkout.payment.copy")}
    </button>
  );
}
