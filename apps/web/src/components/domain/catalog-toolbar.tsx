import type { ReactNode } from "react";

import { Chip } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Search field and sort control, sitting to the right of a page title. Slots
 * rather than props for the controls themselves: the catalog uses a native
 * Select, and a filtered search view may want a popover instead.
 */
export function CatalogToolbar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      {children}
    </div>
  );
}

export type Facet = {
  value: string;
  label: ReactNode;
};

export type FilterChipsProps = {
  facets: Facet[];
  /** The active facet. Single-select, as the catalog draws it. */
  value?: string;
  onChange?: (value: string) => void;
  /** Names the row for assistive tech — "Filter by category". */
  label: string;
  className?: string;
};

/** The facet row. Active is ink on cream; the rest are tint. */
export function FilterChips({
  facets,
  value,
  onChange,
  label,
  className,
}: FilterChipsProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("flex flex-wrap gap-2.5", className)}
    >
      {facets.map((facet) => (
        <Chip
          key={facet.value}
          active={facet.value === value}
          onClick={() => onChange?.(facet.value)}
        >
          {facet.label}
        </Chip>
      ))}
    </div>
  );
}

export type BookMetaProps = {
  /** Label-less pairs: "Paperback", "216 pages", "Penguin Classics", ISBN. */
  items: ReactNode[];
  className?: string;
};

/**
 * The two-column metadata block on a book detail page. Two columns of `auto`
 * with a 14/48 gap, exactly as drawn; stacks to one column on mobile.
 */
export function BookMeta({ items, className }: BookMetaProps) {
  return (
    <ul
      className={cn(
        "grid grid-cols-1 justify-start gap-x-12 gap-y-3.5 text-13 text-secondary sm:grid-cols-2",
        className,
      )}
    >
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}
