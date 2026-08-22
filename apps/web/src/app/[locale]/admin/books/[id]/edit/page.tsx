"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { AdminBookDetail } from "@sakura/contracts";

import { AdminShell } from "@/components/admin/admin-shell";
import { BookForm, type BookFormValues } from "@/components/admin/book-form";
import { AdminApiError, getAdminBook, updateAdminBook } from "@/lib/api/admin";
import { useAdminGate } from "@/lib/use-admin-gate";

export default function EditAdminBookPage() {
  const { checking } = useAdminGate();
  const { id } = useParams<{ id: string }>();

  const [book, setBook] = useState<AdminBookDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (checking) return;
    getAdminBook(id)
      .then(setBook)
      .catch((err: unknown) => setError(messageOf(err, "Could not load this book.")));
  }, [checking, id]);

  async function submit(values: BookFormValues) {
    setSaved(false);
    const updated = await updateAdminBook(id, values);
    setBook(updated);
    setSaved(true);
  }

  return (
    <AdminShell checking={checking}>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-h2 text-ink font-serif">{book ? book.title : "Edit book"}</h1>
          {book ? <p className="text-13.5 text-secondary mt-1">/{book.slug}</p> : null}
        </div>

        {error ? <p className="text-13.5 text-clay-deep">{error}</p> : null}
        {saved ? <p className="text-13.5 text-ink">Saved.</p> : null}

        {book ? (
          <BookForm
            key={book.updatedAt}
            initial={book}
            submitLabel="Save changes"
            onSubmit={submit}
          />
        ) : null}
      </div>
    </AdminShell>
  );
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof AdminApiError ? error.message : fallback;
}
