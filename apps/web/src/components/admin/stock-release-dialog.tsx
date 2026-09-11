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
   eyeful — drag, watch three numbers move, then commit.

   ## The unit

   The question is asked about the copies *in the shop right now*, and the bar
   divides exactly those: held by live invites, kept for the queue, on the
   shelf. The three always sum to what is on hand.

   It used to be asked in the release's own unit, `copies`, and that was the
   bug. `copies` is a running total — it still counts every copy sold through
   the release, and those have left the building. So the dialog capped a total
   at a count: a release of 10 that had sold 2 could never be raised to cover
   the 10 still on hand, because 10 was the ceiling, and the two copies it
   could not reach fell through to the public shelf with no control on screen
   that could move them. Asked in today's units, the ceiling is simply the
   copies nobody is holding, and the server adds back what the release has
   already used — inside its own transaction, where that figure is current.
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
  onHand: number;
  /**
   * Copies live invites are holding, whichever release charged them.
   *
   * Not part of the decision and not movable from here: each one is owed to a
   * person with a working link. They are drawn so the bar still sums to what
   * is on hand, and so it is obvious why the slider stops short of it.
   */
  held: number;
  /**
   * The open release's unspent reserve — how many copies it is keeping for
   * the queue right now. Undefined when there is no release to change, which
   * is also what makes this a first decision rather than a correction.
   */
  currentHold?: number;
  busy?: boolean;
  /** `hold`: how many of the free copies to keep for the queue. */
  onSubmit: (hold: number, note: string) => Promise<void> | void;
};

export function StockReleaseDialog({
  onClose,
  bookTitle,
  onHand,
  held,
  currentHold,
  busy = false,
  onSubmit,
}: StockReleaseDialogProps) {
  const isNew = currentHold === undefined;

  /* Nobody's copies but the shop's. Floored because an over-issued book —
     more held than on hand — has none to give, not a negative number of them. */
  const free = Math.max(onHand - held, 0);
  const overIssued = held > onHand;

  /* A new release must set something aside, or it is not a release. A
     correction may go to zero: "keep nothing more for the queue" is a real
     decision on a release that has already been used. */
  const min = isNew ? Math.min(1, free) : 0;

  /* Opens on "all of it" for a first decision — the answer on most restock
     days, and the one staff would otherwise type. A correction opens where
     the release stands now, so an accidental save changes nothing. */
  const [hold, setHold] = useState(isNew ? free : Math.min(currentHold, free));
  const [note, setNote] = useState("");

  const clamped = Math.min(Math.max(hold, min), free);
  const shelf = free - clamped;

  /* Over the larger of the two, so an over-issued book still draws a whole
     bar — all of it held — rather than segments wider than the track. */
  const base = Math.max(onHand, held);
  const pct = (value: number) => (base > 0 ? (value / base) * 100 : 0);

  const nothingToGive = isNew && free === 0;

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={isNew ? "Set the waitlist's share" : "Change the waitlist's share"}
      description={
        <>
          <span className="text-ink font-medium">{bookTitle}</span> — of the {free} cop
          {free === 1 ? "y" : "ies"} nobody is holding, decide how many the queue may be promised.
          The rest go on the shelf for walk-in customers.
        </>
      }
      actions={
        <>
          <Button
            type="button"
            loading={busy}
            disabled={nothingToGive}
            onClick={() => void onSubmit(clamped, note.trim())}
          >
            {`Keep ${clamped} for the queue`}
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {/* The bar. Three segments over what is on hand, so the split reads as
            a division of a fixed thing rather than as three free numbers. */}
        <div>
          <div className="bg-tint flex h-3 w-full overflow-hidden rounded-full">
            <div className="bg-clay-deep h-full" style={{ width: `${pct(held)}%` }} aria-hidden />
            <div className="bg-clay h-full" style={{ width: `${pct(clamped)}%` }} aria-hidden />
            <div className="bg-node h-full" style={{ width: `${pct(shelf)}%` }} aria-hidden />
          </div>

          <dl className="text-13.5 mt-3 grid grid-cols-3 gap-3">
            {[
              { label: "Held by invites", value: held, swatch: "bg-clay-deep" },
              { label: "Kept for the queue", value: clamped, swatch: "bg-clay" },
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
              Queue gets {clamped} of {free} free
            </span>
            <input
              type="range"
              min={min}
              max={free}
              value={clamped}
              disabled={busy || free === min}
              onChange={(event) => setHold(Number(event.target.value))}
              className="accent-clay w-full"
            />
          </label>

          {/* The number stays typeable. A slider is faster for "about half" and
              useless for "exactly 47", and restock decisions are both. */}
          <Input
            type="number"
            min={min}
            max={free}
            value={String(clamped)}
            disabled={busy}
            onChange={(event) => setHold(Number(event.target.value))}
            aria-label="Copies kept for the queue"
            fieldClassName="w-24"
          />
        </div>

        {held > 0 ? (
          <p className="text-caption text-muted">
            {held} cop{held === 1 ? "y is" : "ies are"} held by people with a live invite. They are
            not part of this decision, and nothing here touches their links.
          </p>
        ) : null}

        {nothingToGive ? (
          <p className="text-caption text-clay-deep font-medium">
            Every copy on hand is already held, so there is nothing to set aside. Record a delivery
            first.
          </p>
        ) : null}

        {overIssued ? (
          <p className="text-caption text-clay-deep font-medium">
            More copies are held than this book has on hand. Raise the stock count or withdraw an
            invite.
          </p>
        ) : null}

        {/* Said out loud because it is the consequence staff are least likely
            to predict: the shelf drops the moment this is saved, before anybody
            is texted. */}
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
