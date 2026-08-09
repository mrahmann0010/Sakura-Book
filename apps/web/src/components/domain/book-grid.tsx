import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * The uniform grid: 2 up mobile, 3 tablet, 4 desktop, 40px gutter. Catalog,
 * search results, "recently added", "more like this" — every grid-shaped
 * context in the references uses this exact arrangement.
 *
 * Takes children rather than a `books` array so a page can drop a skeleton, an
 * ad slot or a "load more" cell into the same flow.
 */
export function BookGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("grid-books", className)}>{children}</div>;
}

/**
 * The asymmetric shelf: a large title at `1/span 5`, then two supporting
 * titles at `7/span 3` and `10/span 3`, the last dropped by 88px.
 *
 * Reserved for hand-curated shelves — the doc explicitly forbids it in the
 * catalog — so the type demands exactly three children and nothing else.
 */
export function CuratedShelf({
  children,
  className,
}: {
  children: [ReactNode, ReactNode, ReactNode];
  className?: string;
}) {
  const [feature, second, third] = children;

  return (
    <div className={cn("grid-shelf", className)}>
      <div className="col-span-full lg:col-span-5 lg:col-start-1">{feature}</div>
      <div className="col-span-full sm:col-span-6 lg:col-span-3 lg:col-start-7">
        {second}
      </div>
      <div className="col-span-full sm:col-span-6 lg:col-span-3 lg:col-start-10 lg:mt-24">
        {third}
      </div>
    </div>
  );
}

/**
 * Horizontal snap rail. Not drawn in the references — every skeleton is at
 * 1440px — but §11.10 leaves mobile shelf behaviour open, and a shelf that
 * reflows into a 2-up grid stops reading as a shelf.
 */
export function BookScroller({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "-mx-page-mobile flex snap-x snap-mandatory gap-8 overflow-x-auto px-page-mobile py-2",
        "sm:mx-0 sm:px-0",
        "[&>*]:w-1/2 [&>*]:shrink-0 [&>*]:snap-start sm:[&>*]:w-1/3 lg:[&>*]:w-1/4",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Placeholder that holds the exact shape of a BookCard, staggered 120ms per
 * cell, so nothing shifts when the real covers land.
 */
export function BookCardSkeleton({ index = 0 }: { index?: number }) {
  return (
    <div>
      <Skeleton index={index} className="aspect-[2/3] w-full rounded-control" />
      <Skeleton index={index} className="mt-4.5 h-3.5" />
      <Skeleton index={index} className="mt-2.5 h-2.5 w-3/5" />
    </div>
  );
}

/** A full grid of them. `count` matches the page size the real grid will show. */
export function BookGridSkeleton({
  count = 8,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <BookGrid className={className}>
      {Array.from({ length: count }, (_, index) => (
        <BookCardSkeleton key={index} index={index} />
      ))}
    </BookGrid>
  );
}
