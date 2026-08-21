import Link from "next/link";
import type { ReactNode } from "react";

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
      <div className="gap-gutter rounded-container bg-tint grid p-8 sm:grid-cols-2 sm:p-12 lg:grid-cols-[2fr_1fr_1fr_1fr] lg:p-14">
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
