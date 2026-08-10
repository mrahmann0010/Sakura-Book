"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";

/** Books · Fiction · The Hearing Trumpet. Last crumb is the current page. */
export function Breadcrumbs({
  items,
  className,
}: {
  items: { href?: string; label: string }[];
  className?: string;
}) {
  return (
    <nav aria-label="Breadcrumb" className={cn("text-caption text-secondary", className)}>
      <ol className="flex flex-wrap items-center gap-2">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;

          return (
            <li key={item.label} className="flex items-center gap-2">
              {item.href && !isLast ? (
                <Link href={item.href} className="hover:text-clay">
                  {item.label}
                </Link>
              ) : (
                <span
                  className={isLast ? "text-ink" : undefined}
                  aria-current={isLast ? "page" : undefined}
                >
                  {item.label}
                </span>
              )}
              {!isLast ? <span aria-hidden>·</span> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
