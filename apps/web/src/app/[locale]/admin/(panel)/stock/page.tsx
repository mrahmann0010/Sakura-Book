"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, PackageX } from "lucide-react";
import type { AdminStockRow } from "@sakura/contracts";

import { AdminTableRows } from "@/components/admin/skeletons";
import { StockReleaseDialog } from "@/components/admin/stock-release-dialog";
import { Button, Input, Modal, Notice } from "@/components/ui";
import {
  AdminApiError,
  closeAdminWaitlistAllocation,
  getAdminStock,
  openAdminWaitlistAllocation,
  resizeAdminWaitlistAllocation,
  updateAdminBook,
} from "@/lib/api/admin";

/* --------------------------------------------------------------------------
   The stock desk.

   One screen for a sentence a shopkeeper says in one breath: "sixty arrived,
   fifty go to the people waiting, ten stay on the shelf." That sentence used
   to be three screens and a guess — stock in the catalog form between the
   cover and the SEO fields, the queue's share behind a filter on the waitlist
   page, and the shelf figure nowhere in the admin panel at all.

   Two numbers a person types, everything else derived. `onHand` and the
   release's `copies` are the only inputs here; promised, reserved and on-shelf
   are read from the same expressions the storefront sells against, so this
   screen cannot drift from the shop it describes.

   No pagination, no filters, and the warnings sort to the top — a title that
   will refuse every invite it is asked to send is exactly the one that must
   not be reachable only by scrolling.
   -------------------------------------------------------------------------- */

/** The three states a row can be in, and what each one asks of a person. */
function rowFlag(row: AdminStockRow): { tone: "error" | "warn"; text: string } | null {
  if (row.overIssued) {
    return {
      tone: "error",
      text: "More promised than you have — the website is refusing to sell this.",
    };
  }

  if (row.waiting > 0 && row.allocationId === null) {
    return {
      tone: "warn",
      text: `${row.waiting} waiting, nothing set aside — invites for this book will not send.`,
    };
  }

  /* The trap this whole flag exists for. A release that has sold through looks
     exactly like a healthy one — an open release, a share that reads the number
     you set — and refuses every invite. Setting the same share again changes
     nothing, because a copy that sells stays charged to the release that sold
     it, so it is the *release* that has to be replaced, not the number. */
  if (row.releaseSpent && row.waiting > 0) {
    return {
      tone: "warn",
      text: `This release has used all ${row.allocationCopies} of its copies. Close it and start a new one — ${row.onShelf} on the shelf are waiting to be given out.`,
    };
  }

  return null;
}

export default function AdminStockPage() {
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? "en";

  const [items, setItems] = useState<AdminStockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Which book's panel is open. The row is the record; there is no detail
   *  page, for the same reason the waitlist has none. */
  const [openRow, setOpenRow] = useState<AdminStockRow | null>(null);
  const [releaseFor, setReleaseFor] = useState<AdminStockRow | null>(null);
  const [receiveFor, setReceiveFor] = useState<AdminStockRow | null>(null);
  const [correctFor, setCorrectFor] = useState<AdminStockRow | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const list = await getAdminStock();
      setItems(list.items);
      /* Re-read the open panel from the new list rather than keeping the row
         object the click captured. Saving a share changes three of its numbers,
         and a panel still showing the old ones is how somebody sets the same
         thing twice. */
      setOpenRow((current) =>
        current ? (list.items.find((row) => row.bookId === current.bookId) ?? null) : null,
      );
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Could not load stock.");
    } finally {
      setLoading(false);
    }
  }

  /**
   * Set a book's stock count — shared by receiving and by correcting.
   *
   * Both arrive here as a final total, so the difference between "forty more
   * came in" and "there are actually five" lives entirely in the dialog that
   * asked. Goes through the books endpoint because that is the only writer of
   * `stock_quantity`: this screen is a better place to *decide* the number,
   * not a second place to store it.
   */
  async function saveStock(row: AdminStockRow, onHand: number) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await updateAdminBook(row.bookId, { stockQuantity: onHand });
      setReceiveFor(null);
      setCorrectFor(null);
      setNotice(`${row.title} — now ${onHand} on hand.`);
      await load();
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Could not update that stock count.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Commit a share, by whichever route the book's state calls for.
   *
   * Three cases, one dialog:
   *
   *   no release      open one
   *   live release    resize it in place
   *   spent release   close it, then open its successor
   *
   * Resizing keeps the row, which is right while a release is still working —
   * closing and reopening there would reset what it has committed and
   * re-promise copies already given out. A release that has sold through is
   * replaced instead, because a new delivery landing on a spent release is a
   * new restock, and the history should read one release per restock.
   * `releaseSpent` is the server's word for which of the two this is; the
   * browser does not guess it.
   *
   * Every route is given `hold` — how many of the copies free right now to
   * keep for the queue — never a total. For a new release the two are the
   * same number. For a resize the server adds what the release has already
   * used, inside its own transaction; the browser used to do that sum itself,
   * in the wrong unit, and capped every share at the stock count.
   */
  async function saveShare(row: AdminStockRow, hold: number, note: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (row.allocationId && row.releaseSpent) {
        await closeAdminWaitlistAllocation(row.allocationId, row.bookId);
        await openAdminWaitlistAllocation({
          bookId: row.bookId,
          copies: hold,
          note: note || undefined,
        });
      } else if (row.allocationId) {
        await resizeAdminWaitlistAllocation(row.allocationId, row.bookId, {
          hold,
          note: note || undefined,
        });
      } else {
        await openAdminWaitlistAllocation({
          bookId: row.bookId,
          copies: hold,
          note: note || undefined,
        });
      }

      setReleaseFor(null);
      setNotice(`${row.title} — ${hold} kept for the queue.`);
      await load();
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Could not set that share.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * End a book's release, from the same panel that set it.
   *
   * Lived only on the waitlist page, behind a book filter, so the screen where
   * the stock decision is made could open a release and change it but never
   * end one — and ending one is half of "start over for this restock".
   *
   * The confirmation spells out what closing does *not* do, because that is
   * the misreading that makes staff hesitate: anyone holding an invite keeps
   * it, their copies stay held, and nothing is sent to them. What stops is new
   * invites being charged to this release. Once closed, the panel offers "Set
   * the share", which opens the next one in the same place.
   */
  async function closeShare(row: AdminStockRow) {
    if (!row.allocationId) return;

    if (
      !window.confirm(
        `Close the release for ${row.title}?\n\nNo new invites will be charged to it. Anyone already holding an invite keeps it, with their copy and their window — nothing is sent to them.\n\nThe copies it was keeping for the queue go back on the shelf until you set a new share.`,
      )
    ) {
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await closeAdminWaitlistAllocation(row.allocationId, row.bookId);
      setNotice(`${row.title} — release closed. Set a new share whenever you are ready.`);
      await load();
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Could not close that release.");
    } finally {
      setBusy(false);
    }
  }

  const needingAttention = items.filter((row) => rowFlag(row) !== null).length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-24 text-ink font-serif leading-tight">Stock</h1>
          <p className="text-13.5 text-secondary mt-1">
            How many copies exist, and who they are owed to. Set the count and the queue&rsquo;s
            share here; everything else is worked out.
          </p>
        </div>

        {!loading ? (
          <p className="text-13.5 text-secondary">
            {needingAttention === 0
              ? `${items.length} title${items.length === 1 ? "" : "s"} · nothing needs attention`
              : `${needingAttention} of ${items.length} need attention`}
          </p>
        ) : null}
      </div>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {notice ? <Notice>{notice}</Notice> : null}

      <div className="rounded-control border-rule bg-surface overflow-x-auto border">
        <table className="w-full min-w-215 text-left">
          <thead className="border-rule text-caption text-muted border-b">
            <tr>
              <th className="px-4 py-3 font-medium">Book</th>
              <th className="px-4 py-3 font-medium">On hand</th>
              <th className="px-4 py-3 font-medium">Promised</th>
              <th className="px-4 py-3 font-medium">Reserved</th>
              <th className="px-4 py-3 font-medium">On shelf</th>
              <th className="px-4 py-3 font-medium">Waiting</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="text-13.5 divide-rule divide-y">
            {loading ? <AdminTableRows rows={5} columns={7} /> : null}

            {items.map((row) => {
              const flag = rowFlag(row);

              return (
                <tr key={row.bookId}>
                  <td className="px-4 py-3">
                    <span className="text-ink block font-medium">{row.title}</span>
                    {flag ? (
                      <span
                        className={`text-caption mt-1 flex items-center gap-1.5 ${
                          flag.tone === "error" ? "text-clay-deep font-medium" : "text-clay"
                        }`}
                      >
                        {flag.tone === "error" ? (
                          <PackageX className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        ) : (
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        )}
                        {flag.text}
                      </span>
                    ) : null}
                  </td>
                  <td className="text-ink px-4 py-3">{row.onHand}</td>
                  <td className="text-secondary px-4 py-3">{row.promised}</td>
                  <td className="text-secondary px-4 py-3">
                    {row.reserved}
                    {/* The budget behind the number, since "32 reserved" and
                        "32 of 50 left" answer different questions and staff
                        are usually asking the second. */}
                    {row.allocationCopies !== null ? (
                      <span className="text-caption text-muted block">
                        of {row.allocationCopies} allocated
                      </span>
                    ) : null}
                  </td>
                  <td className="text-ink px-4 py-3 font-medium">{row.onShelf}</td>
                  <td className="text-secondary px-4 py-3">
                    {row.waiting}
                    {row.waitingQuantity !== row.waiting ? (
                      <span className="text-caption text-muted block">
                        {row.waitingQuantity} copies
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setOpenRow(row)}
                      className="text-clay hover:text-clay-deep"
                    >
                      Manage
                    </button>
                  </td>
                </tr>
              );
            })}

            {!loading && items.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-muted px-4 py-6 text-center">
                  No active titles.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* The one book's panel: the count, the split, and the way through to the
          queue it funds. Three steps of one restock, in the order they happen. */}
      {openRow ? (
        <Modal
          open
          size="md"
          onClose={() => setOpenRow(null)}
          title={openRow.title}
          description={`${openRow.onHand} on hand · ${openRow.promised} promised · ${openRow.reserved} reserved · ${openRow.onShelf} on the shelf`}
          actions={
            <Button type="button" variant="ghost" onClick={() => setOpenRow(null)}>
              Close
            </Button>
          }
        >
          <div className="flex flex-col gap-5">
            <div>
              <p className="text-caption text-muted mb-2">Copies in the shop</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() => setReceiveFor(openRow)}
                >
                  Books arrived
                </Button>
                {/* Corrections belong here too, not on the book form. Sending
                    someone to a page of covers, prices and SEO fields to fix a
                    number is how the wrong field gets edited on the way past —
                    and it is the daily job being made a visitor inside the
                    rare one. */}
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => setCorrectFor(openRow)}
                >
                  Correct the count
                </Button>
              </div>
            </div>

            <div>
              <p className="text-caption text-muted mb-2">The queue&rsquo;s share</p>
              <div className="flex flex-wrap items-center gap-2">
                {/* Labelled with what it will actually do. "Change share" over
                    a spent release would be a lie twice over: the number is
                    not what changes, and the release itself is replaced. */}
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() => setReleaseFor(openRow)}
                >
                  {openRow.releaseSpent
                    ? "Start a new release"
                    : openRow.allocationId
                      ? "Change share"
                      : "Set the share"}
                </Button>
                {/* Only while there is something to end. After closing, the
                    button beside it becomes "Set the share" — the re-release
                    happens in the same place, which is the point. */}
                {openRow.allocationId ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => void closeShare(openRow)}
                  >
                    Close release
                  </Button>
                ) : null}
                {openRow.waiting > 0 ? (
                  <Link
                    href={`/${locale}/admin/waitlist?bookId=${openRow.bookId}`}
                    className="text-13.5 text-clay hover:text-clay-deep"
                  >
                    {openRow.waiting} waiting →
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        </Modal>
      ) : null}

      {receiveFor ? (
        <ReceiveStockDialog
          row={receiveFor}
          busy={busy}
          onClose={() => setReceiveFor(null)}
          onSubmit={(onHand) => void saveStock(receiveFor, onHand)}
        />
      ) : null}

      {correctFor ? (
        <CorrectStockDialog
          row={correctFor}
          busy={busy}
          onClose={() => setCorrectFor(null)}
          onSubmit={(onHand) => void saveStock(correctFor, onHand)}
        />
      ) : null}

      {releaseFor ? (
        <StockReleaseDialog
          onClose={() => setReleaseFor(null)}
          bookTitle={releaseFor.title}
          onHand={releaseFor.onHand}
          /* Every live invite on the book, whichever release charged it — the
             same figure the storefront subtracts, so the dialog's "free" and
             the shelf agree. */
          held={releaseFor.promised}
          /* The reserve being changed, so a correction opens where the release
             stands. Undefined for a first release and for a spent one, which
             is replaced rather than changed — its successor keeps nothing yet. */
          currentHold={
            releaseFor.allocationId && !releaseFor.releaseSpent ? releaseFor.reserved : undefined
          }
          busy={busy}
          onSubmit={(hold, note) => void saveShare(releaseFor, hold, note)}
        />
      ) : null}
    </div>
  );
}

/**
 * "Forty more arrived."
 *
 * Additive, because that is what happens on a restock morning and because the
 * absolute field it replaces made every delivery an arithmetic problem with
 * the shop's stock count as the prize for getting it wrong. The resulting
 * total is shown before it is saved, so the number being written is never a
 * surprise.
 *
 * A correction — a stocktake, damaged copies — is deliberately not here. It is
 * rarer, it is destructive, and it belongs on the book itself where the rest
 * of the title's record lives.
 */
function ReceiveStockDialog({
  row,
  busy,
  onClose,
  onSubmit,
}: {
  row: AdminStockRow;
  busy: boolean;
  onClose: () => void;
  onSubmit: (onHand: number) => void;
}) {
  const [arrived, setArrived] = useState("");

  const parsed = Number(arrived);
  const valid = Number.isInteger(parsed) && parsed > 0;
  const total = valid ? row.onHand + parsed : row.onHand;

  return (
    <Modal
      open
      onClose={onClose}
      title="Books arrived"
      description={`${row.title} — how many copies came in? They are added to the ${row.onHand} already counted.`}
      actions={
        <>
          <Button type="button" loading={busy} disabled={!valid} onClick={() => onSubmit(total)}>
            {valid ? `Make it ${total}` : "Add"}
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <Input
        type="number"
        min={1}
        autoFocus
        label="Copies that arrived"
        hint={
          valid ? `${row.onHand} + ${parsed} = ${total} on hand` : "A whole number, at least one."
        }
        value={arrived}
        disabled={busy}
        onChange={(event) => setArrived(event.target.value)}
      />
    </Modal>
  );
}

/**
 * "Actually there are five."
 *
 * A stocktake, breakages, a miscount found on the shelf. Absolute rather than
 * additive, because a correction is a statement about what is there now and
 * not about a movement — and separate from receiving for exactly that reason:
 * the two are different claims, and one keypress apart is too close for a
 * screen where one of them can strand a customer.
 *
 * Which is what the warning below is for. Lowering stock under copies already
 * promised does not withdraw those invites — the links keep working and the
 * holds keep standing — it just means the shop has promised more than it owns,
 * and the storefront responds by refusing to sell the title to anybody until a
 * person resolves it. That consequence is invisible from the number alone, so
 * it is spelled out before the save rather than discovered afterwards on the
 * Stock table's red row.
 */
function CorrectStockDialog({
  row,
  busy,
  onClose,
  onSubmit,
}: {
  row: AdminStockRow;
  busy: boolean;
  onClose: () => void;
  onSubmit: (onHand: number) => void;
}) {
  const [count, setCount] = useState(String(row.onHand));

  const parsed = Number(count);
  const valid = Number.isInteger(parsed) && parsed >= 0;
  const shortfall = valid ? row.promised - parsed : 0;

  return (
    <Modal
      open
      onClose={onClose}
      title="Correct the count"
      description={`${row.title} — what is actually on the shelf? This replaces the count of ${row.onHand} rather than adding to it.`}
      actions={
        <>
          <Button type="button" loading={busy} disabled={!valid} onClick={() => onSubmit(parsed)}>
            {valid ? `Set it to ${parsed}` : "Save"}
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          type="number"
          min={0}
          autoFocus
          label="Copies on hand"
          hint={valid ? undefined : "A whole number, zero or more."}
          value={count}
          disabled={busy}
          onChange={(event) => setCount(event.target.value)}
        />

        {shortfall > 0 ? (
          <Notice tone="error" lead="This will over-issue the book.">
            {row.promised} cop{row.promised === 1 ? "y is" : "ies are"} already promised to people
            holding a live link. Their links keep working — but the website will refuse to sell this
            title to anyone until you print more or withdraw {shortfall} invite
            {shortfall === 1 ? "" : "s"}.
          </Notice>
        ) : null}
      </div>
    </Modal>
  );
}
