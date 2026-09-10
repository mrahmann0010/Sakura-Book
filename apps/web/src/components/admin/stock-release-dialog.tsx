"use client";

import { useState } from "react";

import { Button, Input, Modal, Textarea } from "@/components/ui";

/* --------------------------------------------------------------------------
   Deciding how many copies of a restock the waitlist gets.

   This replaces a `window.prompt`, and the reason it is worth a component is
   not politeness: the prompt asked for a number with no way to see what that
   number does. Staff were typing "50" into a box and finding out what it cost
   the shelf by loading the storefront afterwards.

   Everything here exists to put the decision and its consequence in the same
   eyeful — drag, watch three numbers move, then commit. The arithmetic is
   deliberately duplicated from `WaitlistAllocationService.spendableByBook`
   rather than fetched: this is a *preview* of a number that does not exist
   yet, so there is nothing on the server to ask.
   -------------------------------------------------------------------------- */

export type StockReleaseDialogProps = {
  /**
   * Mounted only while open — the caller renders it conditionally rather than
   * passing `open`. That makes the initial split a `useState` seed instead of
   * an effect that re-syncs, so last week's 60-copy number can never survive
   * into this week's 12-copy restock.
   */
  onClose: () => void;
  bookTitle: string;
  /** `books.stock_quantity` — the copies that physically exist. */
  stockQuantity: number;
  /**
   * Copies already promised through live invites.
   *
   * The floor of the slider, and not an arbitrary one: those copies are spoken
   * for by people holding a working link, so a release smaller than this would
   * be a budget already overspent the moment it opened.
   */
  committed: number;
  /** The open release's size, when this is a re-decision rather than a first. */
  currentCopies?: number;
  busy?: boolean;
  onSubmit: (copies: number, note: string) => Promise<void> | void;
};

export function StockReleaseDialog({
  onClose,
  bookTitle,
  stockQuantity,
  committed,
  currentCopies,
  busy = false,
  onSubmit,
}: StockReleaseDialogProps) {
  /* Opens on "all of it", which is the answer on most restock days and the one
     staff would otherwise type. Holding some back is the deliberate act, so
     that is the one that costs a drag. */
  const [copies, setCopies] = useState(currentCopies ?? Math.max(stockQuantity, committed));
  const [note, setNote] = useState("");

  const max = Math.max(stockQuantity, committed);
  const clamped = Math.min(Math.max(copies, committed), max);

  /* The three segments, and the invariant the bar exists to show: they sum to
     what is on hand. `toGiveOut` is what staff can actually send right now;
     `shelf` is what the decision leaves the public. */
  const toGiveOut = Math.max(clamped - committed, 0);
  const shelf = Math.max(stockQuantity - clamped, 0);

  const pct = (value: number) => (stockQuantity > 0 ? (value / stockQuantity) * 100 : 0);

  const overStock = committed > stockQuantity;

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={currentCopies ? "Change the waitlist's share" : "Set the waitlist's share"}
      description={
        <>
          <span className="text-ink font-medium">{bookTitle}</span> — decide how many of the{" "}
          {stockQuantity} cop{stockQuantity === 1 ? "y" : "ies"} on hand the queue may be promised.
          The rest stay on the shelf for walk-in customers.
        </>
      }
      actions={
        <>
          <Button
            type="button"
            loading={busy}
            disabled={overStock}
            onClick={() => void onSubmit(clamped, note.trim())}
          >
            {`Give the queue ${clamped}`}
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {/* The bar. Three segments over one width, so the split is read as a
            division of a fixed thing rather than as three free numbers. */}
        <div>
          <div className="bg-tint flex h-3 w-full overflow-hidden rounded-full">
            <div
              className="bg-clay-deep h-full"
              style={{ width: `${pct(committed)}%` }}
              aria-hidden
            />
            <div className="bg-clay h-full" style={{ width: `${pct(toGiveOut)}%` }} aria-hidden />
            <div className="bg-node h-full" style={{ width: `${pct(shelf)}%` }} aria-hidden />
          </div>

          <dl className="text-13.5 mt-3 grid grid-cols-3 gap-3">
            {[
              { label: "Already promised", value: committed, swatch: "bg-clay-deep" },
              { label: "Left to give out", value: toGiveOut, swatch: "bg-clay" },
              { label: "On the shelf", value: shelf, swatch: "bg-node" },
            ].map((segment) => (
              <div key={segment.label}>
                <dt className="text-caption text-muted flex items-center gap-1.5">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${segment.swatch}`}
                    aria-hidden
                  />
                  {segment.label}
                </dt>
                <dd className="text-ink mt-0.5 font-medium">{segment.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="flex items-end gap-4">
          <label className="flex-1">
            <span className="text-caption text-muted mb-2 block">
              Waitlist gets {clamped} of {stockQuantity}
            </span>
            <input
              type="range"
              min={committed}
              max={max}
              value={clamped}
              disabled={busy || max === committed}
              onChange={(event) => setCopies(Number(event.target.value))}
              className="accent-clay w-full"
            />
          </label>

          {/* The number stays typeable. A slider is faster for "about half" and
              useless for "exactly 47", and restock decisions are both. */}
          <Input
            type="number"
            min={committed}
            max={max}
            value={String(clamped)}
            disabled={busy}
            onChange={(event) => setCopies(Number(event.target.value))}
            aria-label="Copies for the waitlist"
            fieldClassName="w-24"
          />
        </div>

        {committed > 0 ? (
          <p className="text-caption text-muted">
            {committed} cop{committed === 1 ? "y is" : "ies are"} already promised to people holding
            a live link, so the share cannot go below that. Withdraw those invites first if you need
            to.
          </p>
        ) : null}

        {overStock ? (
          <p className="text-caption text-clay-deep font-medium">
            More copies are promised than this book has on hand. Raise the stock count or withdraw
            an invite — no release can be set until that is resolved.
          </p>
        ) : null}

        {/* The bar reads as a reservation, and now it is one. Said out loud
            because it is the consequence staff are least likely to predict:
            the shelf drops the moment this is saved, before anybody is
            texted. */}
        <p className="text-caption text-muted">
          These copies leave the website as soon as you save — walk-in customers will see{" "}
          {shelf === 0 ? "the book as sold out" : `only ${shelf} available`} until invites are spent
          or their windows lapse.
        </p>

        <Textarea
          label="Note (optional)"
          hint="Why this split — read later from the release history."
          placeholder="Sept restock, 10 for the shop counter"
          rows={2}
          maxLength={500}
          value={note}
          disabled={busy}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
    </Modal>
  );
}
