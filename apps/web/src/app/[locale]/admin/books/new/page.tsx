"use client";

import { useParams, useRouter } from "next/navigation";

import { AdminShell } from "@/components/admin/admin-shell";
import { BookForm, type BookFormValues } from "@/components/admin/book-form";
import { createAdminBook } from "@/lib/api/admin";
import { useAdminGate } from "@/lib/use-admin-gate";

export default function NewAdminBookPage() {
  const { checking } = useAdminGate();
  const { locale } = useParams<{ locale: string }>();
  const router = useRouter();

  async function submit(values: BookFormValues) {
    const created = await createAdminBook(values);
    router.push(`/${locale}/admin/books/${created.id}/edit`);
  }

  return (
    <AdminShell checking={checking}>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-h2 text-ink font-serif">New book</h1>
          <p className="text-13.5 text-secondary mt-1">
            The URL slug is generated from the title automatically.
          </p>
        </div>

        <BookForm submitLabel="Create book" onSubmit={submit} />
      </div>
    </AdminShell>
  );
}
