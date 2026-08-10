import Link from "next/link";

import { cn } from "@/lib/utils";

export type PaginationProps = {
  page: number;
  totalPages: number;
  /** Builds the href for a page — the catalog keeps its filters in the URL,
      so pagination cannot just append `?page=`. */
  hrefFor: (page: number) => string;
  /** Names the control for assistive tech. */
  label: string;
  /** "Page 2 of 5" — read out, not drawn, so the current page is announced. */
  statusFor?: (page: number) => string;
  className?: string;
};

/**
 * Numbered pages, centred under a hairline. Links rather than buttons: each
 * page is a real URL, so it opens in a new tab and survives a reload.
 *
 * Renders nothing on a single page — a control that cannot do anything is
 * noise, not reassurance.
 */
export function Pagination({
  page,
  totalPages,
  hrefFor,
  label,
  statusFor,
  className,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages = Array.from({ length: totalPages }, (_, index) => index + 1);

  return (
    <nav aria-label={label} className={cn("hairline flex justify-center gap-2 pt-6", className)}>
      {pages.map((value) => {
        const current = value === page;

        return (
          <Link
            key={value}
            href={hrefFor(value)}
            aria-current={current ? "page" : undefined}
            aria-label={statusFor?.(value)}
            className={cn(
              "rounded-md text-13 inline-flex size-8 items-center justify-center border",
              "transition-colors duration-150",
              current
                ? "border-ink bg-tint text-ink font-semibold"
                : "border-rule text-secondary hover:border-ink hover:text-ink",
            )}
          >
            {value}
          </Link>
        );
      })}
    </nav>
  );
}
