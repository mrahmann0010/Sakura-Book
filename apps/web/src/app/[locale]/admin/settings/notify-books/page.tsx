"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { AdminWaitlistBook } from "@sakura/contracts";

import { AdminShell } from "@/components/admin/admin-shell";
import { Button, Checkbox, Input, Notice } from "@/components/ui";
import { AdminApiError, getAdminWaitlistBooks, updateAdminWaitlistBooks } from "@/lib/api/admin";
import { useAdminGate } from "@/lib/use-admin-gate";

/**
 * Which titles the notify page offers to wait on.
 *
 * The page used to name one book by slug in its own source, so changing the
 * offer took a developer and a deploy — on exactly the days (a reprint
 * announced, a title selling out) when it most wants moving. This is that
 * choice, as a list of checkboxes over the catalog: a shop with five titles
 * can collect names for two.
 *
 * The whole selection is saved at once (PUT, not a per-row toggle). Ticking a
 * box changes nothing until Save, which is what makes "these are the two"
 * something staff can review before it reaches customers — and it means a
 * half-applied selection is not a state the page can be left in.
 */
export default function AdminNotifyBooksPage() {
  const { checking } = useAdminGate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [books, setBooks] = useState<AdminWaitlistBook[]>([]);
  /** The pending selection — the saved flags until someone ticks something. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (checking) return;

    let cancelled = false;

    getAdminWaitlistBooks()
      .then((list) => {
        if (cancelled) return;
        setBooks(list);
        setSelected(new Set(list.filter((book) => book.waitlistEnabled).map((book) => book.id)));
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof AdminApiError ? cause.message : "Could not load the book list.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [checking]);

  /* Filtering the rendered rows only — `selected` is keyed by id and untouched
     by it, so a title scrolled out of view by a search stays selected and is
     still sent on save. A filter that silently dropped ticks would be a way to
     take a book off the page by typing in a search box. */
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();

    if (!needle) return books;

    return books.filter(
      (book) =>
        book.title.toLowerCase().includes(needle) || book.slug.toLowerCase().includes(needle),
    );
  }, [books, filter]);

  const hiddenSelected = selected.size - visible.filter((book) => selected.has(book.id)).length;

  function toggle(id: string, checked: boolean) {
    setSaved(false);
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const updated = await updateAdminWaitlistBooks({ bookIds: [...selected] });
      setBooks(updated);
      setSelected(new Set(updated.filter((book) => book.waitlistEnabled).map((book) => book.id)));
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof AdminApiError ? cause.message : "Could not save the selection.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminShell checking={checking}>
      <div className="flex max-w-2xl flex-col gap-6">
        <div>
          <h1 className="text-h2 text-ink font-serif">Notify Page Books</h1>
          <p className="text-13.5 text-secondary mt-1">
            The titles customers can choose from on the notify page, where they join the restock
            waitlist. Tick only the books you want offered — the rest of the catalog stays off the
            page. With nothing ticked, the form still collects names for the general list; with
            exactly one ticked, it names that book and asks no question.
          </p>
        </div>

        {loading ? (
          <p className="text-13.5 text-secondary">Loading…</p>
        ) : (
          <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
            <Input
              label="Find a title"
              placeholder="Search by title or slug"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />

            <div className="rounded-control border-rule divide-rule flex flex-col divide-y border">
              {visible.length === 0 ? (
                <p className="text-13.5 text-secondary p-4">No titles match that search.</p>
              ) : (
                visible.map((book) => (
                  <Checkbox
                    key={book.id}
                    className="p-3"
                    checked={selected.has(book.id)}
                    onChange={(event) => toggle(book.id, event.target.checked)}
                    /* Stock and status are shown but never enforced: offering a
                       title that is still in stock is a real choice (a reprint
                       announced early), and so is leaving a sold-out one off. */
                    description={`${book.slug} · ${book.stockQuantity} in stock · ${
                      book.availability === "in_stock"
                        ? "available"
                        : book.availability.replace("_", " ")
                    }${book.isActive ? "" : " · inactive, hidden from the page"}`}
                  >
                    {book.title}
                  </Checkbox>
                ))
              )}
            </div>

            {error ? <Notice tone="error">{error}</Notice> : null}
            {saved ? <Notice tone="info">Saved — the notify page shows this list.</Notice> : null}

            <p className="text-caption text-secondary">
              {selected.size === 0
                ? "No titles offered — the notify page collects general-list signups only."
                : `${selected.size} ${selected.size === 1 ? "title" : "titles"} offered.`}
              {hiddenSelected > 0
                ? ` ${hiddenSelected} of them ${hiddenSelected === 1 ? "is" : "are"} hidden by the search and will still be saved.`
                : null}
              {" Changes reach the page within five minutes."}
            </p>

            <Button type="submit" size="sm" disabled={saving} className="self-start">
              {saving ? "Saving…" : "Save"}
            </Button>
          </form>
        )}
      </div>
    </AdminShell>
  );
}
