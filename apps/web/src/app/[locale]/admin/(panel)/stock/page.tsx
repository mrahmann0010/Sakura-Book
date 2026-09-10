"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, PackageX } from "lucide-react";
import type { AdminStockRow } from "@sakura/contracts";

import { AdminTableRows } from "@/components/admin/skeletons";
import { StockReleaseDialog } from "@/components/admin/stock-release-dialog";
import { Button, Input, LinkButton, Modal, Notice } from "@/components/ui";
import {
  AdminApiError,
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
   * Set a book's stock count.
   *
   * Goes through the books endpoint, which is the only writer of
   * `stock_quantity` — this screen is a better place to *decide* the number,
   * not a second way to store it.
   */
  async function saveStock(row: AdminStockRow, onHand: number) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await updateAdminBook(row.bookId, { stockQuantity: onHand });
      setReceiveFor(null);
      setNotice(`${row.title} — now ${onHand} on hand.`);
      await load();
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Could not update that stock count.");
    } finally {
      setBusy(false);
    }
  }

  /** Open a release, or correct the open one. Never close-then-reopen: that
   *  resets what the release has committed and re-promises copies already
   *  given out. */
  async function saveShare(row: AdminStockRow, copies: number, note: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (row.allocationId) {
        await resizeAdminWaitlistAllocation(row.allocationId, row.bookId, {
          copies,
          note: note || undefined,
        });
      } else {
        await openAdminWaitlistAllocation({
          bookId: row.bookId,
          copies,
          note: note || undefined,
        });
      }

      setReleaseFor(null);
      setNotice(`${row.title} — the queue may be promised ${copies}.`);
      await load();
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Could not set that share.");
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
                {/* The count itself — a stocktake, damaged copies — stays on
                    the book, where the rest of the title's record lives. */}
                <LinkButton
                  variant="secondary"
                  size="sm"
                  href={`/${locale}/admin/books/${openRow.bookId}`}
                >
                  Correct the count
                </LinkButton>
              </div>
            </div>

            <div>
              <p className="text-caption text-muted mb-2">The queue&rsquo;s share</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() => setReleaseFor(openRow)}
                >
                  {openRow.allocationId ? "Change share" : "Set the share"}
                </Button>
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

      {releaseFor ? (
        <StockReleaseDialog
          onClose={() => setReleaseFor(null)}
          bookTitle={releaseFor.title}
          stockQuantity={releaseFor.onHand}
          committed={
            /* What this release has already spent: its size less what is left
               of it. Zero when there is no release, which is the floor the
               dialog wants anyway. */
            releaseFor.allocationCopies !== null
              ? Math.max(releaseFor.allocationCopies - releaseFor.reserved, 0)
              : 0
          }
          currentCopies={releaseFor.allocationCopies ?? undefined}
          busy={busy}
          onSubmit={(copies, note) => void saveShare(releaseFor, copies, note)}
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
