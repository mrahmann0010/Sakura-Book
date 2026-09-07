import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui";

/* --------------------------------------------------------------------------
   Loading shapes for the panel.

   A screen that is waiting should look like the screen that is coming. The
   panel used to answer every wait with a sentence — a full-screen "Checking
   session…", a `Loading…` where a form goes, or worse, an empty table with
   "No orders in this view." under it, which is not a wait at all but an
   answer, and the wrong one.

   These hold the exact shape of what lands: same card, same rules, same row
   height. Nothing shifts when the data arrives, and at identical latency the
   screen reads as loading rather than as broken or empty.

   Every bar is `aria-hidden` (see `Skeleton`); the wrapper says the one true
   thing out loud instead, so a screen reader hears "Loading…" rather than a
   hundred unlabelled boxes.
   -------------------------------------------------------------------------- */

function LoadingRegion({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/**
 * Cell widths, cycled by row *and* column.
 *
 * Uniform bars read as a grid of boxes; real rows are ragged in both
 * directions. Cycling on the column alone repeats the same width straight down
 * each column, which is how you get a table that still looks like graph paper.
 * The sequence is fixed rather than random so the server and client render the
 * same thing — a skeleton is not worth a hydration mismatch.
 */
const CELL_WIDTHS = ["w-4/5", "w-3/5", "w-2/3", "w-1/2", "w-3/4", "w-2/5", "w-11/12", "w-1/3"];

function cellWidth(row: number, column: number): string {
  /* Coprime with the array length, so a column's widths do not settle into a
     short repeating pattern down the page. */
  return CELL_WIDTHS[(column + row * 3) % CELL_WIDTHS.length];
}

export type AdminTableRowsProps = {
  /** Match the real table's column count, or the cells will not line up. */
  columns: number;
  rows?: number;
};

/**
 * Body rows only, for dropping into a table that is already on screen.
 *
 * This is the one the list screens use. The real `<thead>` stays put while the
 * rows fill in, so the column headers never move and the reader can already
 * see what is coming — which a skeleton that replaced the whole table would
 * throw away.
 */
export function AdminTableRows({ columns, rows = 6 }: AdminTableRowsProps) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <tr key={row} className="border-rule border-b last:border-0">
          {Array.from({ length: columns }, (_, column) => (
            <td key={column} className="px-4 py-3">
              <Skeleton index={row} className={`h-3.5 ${cellWidth(row, column)}`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/**
 * A whole table in outline — card, header rule and rows — for when there is no
 * real table on screen yet to fill in.
 */
export function AdminTableSkeleton({ columns, rows = 6 }: AdminTableRowsProps) {
  return (
    <div className="rounded-container border-rule bg-surface overflow-hidden border">
      <table className="w-full table-fixed text-left">
        <thead>
          <tr className="border-rule-strong border-b">
            {Array.from({ length: columns }, (_, column) => (
              <th key={column} className="px-4 py-3">
                <Skeleton className="h-2.5 w-16" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <AdminTableRows columns={columns} rows={rows} />
        </tbody>
      </table>
    </div>
  );
}

/**
 * A settings tab mid-load: labels and fields at the size they will be, then
 * the Save button.
 */
export function AdminFormSkeleton({ fields = 3 }: { fields?: number }) {
  return (
    <LoadingRegion label="Loading settings…">
      <div className="flex flex-col gap-4">
        {Array.from({ length: fields }, (_, field) => (
          <div key={field}>
            <Skeleton index={field} className="mb-2 h-2.5 w-24" />
            <Skeleton index={field} className="rounded-control h-11 w-full" />
          </div>
        ))}
      </div>
      <Skeleton className="rounded-control h-11 w-32" />
    </LoadingRegion>
  );
}

/**
 * The dashboard and the payments breakdown: a row of figures over a panel or
 * two, which is the shape both of those screens resolve to.
 */
export function AdminPanelsSkeleton({
  tiles = 4,
  panels = 2,
}: {
  tiles?: number;
  panels?: number;
}) {
  return (
    <LoadingRegion label="Loading…">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: tiles }, (_, tile) => (
          <div key={tile} className="rounded-container border-rule bg-surface border p-5">
            <Skeleton index={tile} className="h-2.5 w-20" />
            <Skeleton index={tile} className="mt-3 h-6 w-24" />
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: panels }, (_, panel) => (
          <div key={panel} className="rounded-container border-rule bg-surface border p-5">
            <Skeleton index={panel} className="h-3 w-32" />
            <div className="mt-4 flex flex-col gap-3">
              {Array.from({ length: 4 }, (_, line) => (
                <div
                  key={line}
                  className="border-rule flex items-center justify-between border-b pb-3 last:border-0"
                >
                  <Skeleton index={line} className="h-3.5 w-2/5" />
                  <Skeleton index={line} className="h-3.5 w-12" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

/**
 * A record screen — the order detail — while its one object is on the wire.
 */
export function AdminDetailSkeleton() {
  return (
    <LoadingRegion label="Loading order…">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Skeleton className="h-7 w-48" />
          <Skeleton className="mt-2 h-3 w-64" />
        </div>
        <Skeleton className="rounded-control h-11 w-28" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, panel) => (
          <div key={panel} className="rounded-container border-rule bg-surface border p-5">
            <Skeleton index={panel} className="h-2.5 w-20" />
            <div className="mt-4 flex flex-col gap-2.5">
              <Skeleton index={panel} className="h-3.5 w-full" />
              <Skeleton index={panel} className="h-3.5 w-4/5" />
              <Skeleton index={panel} className="h-3.5 w-3/5" />
            </div>
          </div>
        ))}
      </div>

      <AdminTableSkeleton columns={4} rows={3} />
    </LoadingRegion>
  );
}

/**
 * What the shell shows while the session is being established.
 *
 * Generic on purpose: the layout renders this above the router, so it cannot
 * know whether a table or a form is coming. It is shaped like the panel's most
 * common screen — a titled list — which is the right guess to be wrong about,
 * because the alternative was a blank page with a sentence in the middle.
 */
export function AdminScreenSkeleton() {
  return (
    <LoadingRegion label="Loading the panel…">
      <div>
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-2 h-3 w-28" />
      </div>

      <div className="border-rule flex gap-6 border-b pb-3">
        {Array.from({ length: 3 }, (_, tab) => (
          <Skeleton key={tab} index={tab} className="h-3 w-20" />
        ))}
      </div>

      <AdminTableSkeleton columns={6} />
    </LoadingRegion>
  );
}
