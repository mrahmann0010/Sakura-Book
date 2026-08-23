"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { AdminBookSummary } from "@sakura/contracts";

import { AdminShell } from "@/components/admin/admin-shell";
import { Button, LinkButton, Modal } from "@/components/ui";
import { AdminApiError, deleteAdminBook, listAdminBooks } from "@/lib/api/admin";
import { formatMoney } from "@/lib/money";
import { useAdminGate } from "@/lib/use-admin-gate";

export default function AdminBooksPage() {
  const { checking } = useAdminGate();
  const { locale } = useParams<{ locale: string }>();

  const [items, setItems] = useState<AdminBookSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [pendingDelete, setPendingDelete] = useState<AdminBookSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!checking) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load() closes over `q`/page, re-run only on the gate clearing
  }, [checking]);

  async function load(query = q) {
    setError(null);
    try {
      const list = await listAdminBooks({ q: query || undefined });
      setItems(list.items);
      setTotal(list.total);
    } catch (err) {
      setError(err instanceof AdminApiError ? err.message : "Could not load the catalog.");
    }
  }

  function askDelete(book: AdminBookSummary) {
    setDeleteError(null);
    setPendingDelete(book);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAdminBook(pendingDelete.id);
      setItems((current) => current.filter((book) => book.id !== pendingDelete.id));
      setTotal((current) => current - 1);
      setPendingDelete(null);
    } catch (err) {
      setDeleteError(
        err instanceof AdminApiError ? err.message : "Could not delete this book.",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AdminShell checking={checking}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-h2 text-ink font-serif">Books</h1>
            <p className="text-13.5 text-secondary mt-1">{total} in the catalog.</p>
          </div>
          <LinkButton href={`/${locale}/admin/books/new`}>New book</LinkButton>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void load();
          }}
          className="flex gap-2"
        >
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Search by title…"
            className="rounded-control border-rule bg-surface text-13.5 text-ink w-full max-w-sm border px-3 py-2"
          />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>

        {error ? <p className="text-13.5 text-clay-deep">{error}</p> : null}

        <div className="rounded-container border-rule bg-surface overflow-x-auto border">
          <table className="text-13.5 w-full min-w-[720px] text-left">
            <thead>
              <tr className="border-rule text-caption text-muted border-b uppercase">
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Authors</th>
                <th className="px-4 py-3 font-medium">Price</th>
                <th className="px-4 py-3 font-medium">Stock</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {items.map((book) => (
                <tr key={book.id} className="border-rule/60 border-b">
                  <td className="flex items-center gap-3 px-4 py-3">
                    {/* eslint-disable-next-line @next/next/no-img-element -- admin-supplied/external URL */}
                    <img
                      src={book.coverImageUrl}
                      alt=""
                      className="border-rule h-12 w-9 rounded-xs border object-cover"
                    />
                    <span className="text-ink">{book.title}</span>
                  </td>
                  <td className="text-secondary px-4 py-3">{book.authors.join(", ") || "—"}</td>
                  <td className="text-ink px-4 py-3">{formatMoney(book.priceCents)}</td>
                  <td className="text-ink px-4 py-3">
                    {book.stockQuantity}
                    {book.stockQuantity <= book.lowStockThreshold ? (
                      <span className="text-clay-deep ml-2">low</span>
                    ) : null}
                  </td>
                  <td className="text-secondary px-4 py-3">
                    {book.isActive ? "Active" : "Inactive"}
                    {book.isFeatured ? " · Featured" : ""}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <Link
                      href={`/${locale}/admin/books/${book.id}/edit`}
                      className="text-clay hover:text-clay-deep"
                    >
                      Edit
                    </Link>
                    <button
                      type="button"
                      onClick={() => askDelete(book)}
                      className="text-clay-deep hover:text-clay ml-4"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-muted px-4 py-6 text-center">
                    No books found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete this book?"
        description={
          pendingDelete
            ? `"${pendingDelete.title}" will be permanently removed. This cannot be undone.`
            : undefined
        }
        actions={
          <>
            <Button onClick={() => void confirmDelete()} loading={deleting} loadingLabel="Deleting">
              Delete
            </Button>
            <Button variant="ghost" onClick={() => setPendingDelete(null)} disabled={deleting}>
              Cancel
            </Button>
          </>
        }
      >
        {deleteError ? <p className="text-13.5 text-clay-deep">{deleteError}</p> : null}
      </Modal>
    </AdminShell>
  );
}
