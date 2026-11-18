import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { Wordmark } from "@/components/ui";
import { cn } from "@/lib/utils";

export type FooterColumn = {
  /** Mono caps column head. */
  heading: string;
  links: { href: string; label: string }[];
};

export type SiteFooterProps = {
  brand?: ReactNode;
  /** 26–28ch of what the shop is. */
  blurb?: ReactNode;
  /** Three columns in the references; the grid takes any number. */
  columns?: FooterColumn[];
  /** Copyright or legal line under the block. */
  note?: ReactNode;
  className?: string;
};

/**
 * Tinted block, 12px radius, 2fr 1fr 1fr 1fr at a 40px gutter. Same on every
 * page that has one — transactional pages drop the footer entirely.
 */
export function SiteFooter({
  brand = "Nihonova Books",
  blurb,
  columns = [],
  note,
  className,
}: SiteFooterProps) {
  return (
    <footer className={cn("shell pb-14", className)}>
      {/* The brand cell takes two tracks, then one per column — written as a
          `repeat()` over `columns.length` rather than a hardcoded `1fr 1fr 1fr`
          so the prop's own doc ("the grid takes any number") is actually true.
          It was not: a fourth column — the "By level" crawl path added by the
          SEO pass — had no track to land in and wrapped onto a second row
          under the blurb at `lg:` only, which is the width nobody checks. */}
      <div
        className="gap-gutter rounded-container bg-tint grid p-8 sm:grid-cols-2 sm:p-12 lg:grid-cols-[2fr_repeat(var(--footer-columns),1fr)] lg:p-14"
        /* The count has to reach CSS as a custom property: the track list is
           inside a `lg:` variant, and an inline `gridTemplateColumns` would
           apply at every width — overriding the `sm:grid-cols-2` stack this
           footer uses on a phone. */
        style={{ "--footer-columns": columns.length } as CSSProperties}
      >
        <div>
          <Wordmark as="p">{brand}</Wordmark>
          {blurb ? (
            <p className="max-w-measure-blurb text-caption text-secondary mt-4">{blurb}</p>
          ) : null}
        </div>

        {columns.map((column) => (
          <div key={column.heading}>
            <p className="eyebrow">{column.heading}</p>
            <ul className="mt-4 flex flex-col gap-2.5">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-13.5 text-secondary hover:text-clay">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {note ? <p className="eyebrow mt-8">{note}</p> : null}
    </footer>
  );
}
