import { notFound } from "next/navigation";

// Pre-order stream disabled — single normal flow for all books.
// Everything below is commented out rather than deleted, in case the
// pre-order stream comes back.

export default function AdminPreOrderBookPage(): never {
  notFound();
}

// "use client";
// 
// import { useEffect, useState, type FormEvent } from "react";
// 
// import { AdminShell } from "@/components/admin/admin-shell";
// import {
//   AdminApiError,
//   createAdminPreOrderBook,
//   listAdminPreOrderBooks,
//   updateAdminPreOrderBook,
// } from "@/lib/api/admin";
// import { useAdminGate } from "@/lib/use-admin-gate";
// import type { PreOrderBook } from "@sakura/contracts";
// 
// const emptyForm = {
//   title: "",
//   authorName: "",
//   description: "",
//   pageCount: "",
//   priceCents: "",
//   compareAtPriceCents: "",
//   coverImageUrl: "",
//   coverImageAlt: "",
//   isActive: true,
// };
// 
// /**
//  * Create/edit the pre-order book. One form, plain and functional: the panel
//  * has exactly one thing to manage today, so there is no list-then-detail
//  * navigation — picking an existing book from the dropdown loads it into the
//  * same form that creates a new one.
//  *
//  * Gated client-side by `useAdminGate` — shared with the pre-order queue, see
//  * that hook for what the gate actually proves.
//  */
// export default function AdminPreOrderBookPage() {
//   const { checking } = useAdminGate();
// 
//   const [books, setBooks] = useState<PreOrderBook[]>([]);
//   const [selectedId, setSelectedId] = useState<string>("");
//   const [form, setForm] = useState(emptyForm);
//   const [saving, setSaving] = useState(false);
//   const [message, setMessage] = useState<string | null>(null);
//   const [error, setError] = useState<string | null>(null);
// 
//   /* Load once the gate has cleared, never before: an unauthenticated fetch
//      would 401 and surface as "could not load pre-order books" over the top of
//      a redirect that is already happening. */
//   useEffect(() => {
//     if (!checking) void loadBooks();
//   }, [checking]);
// 
//   async function loadBooks() {
//     try {
//       const list = await listAdminPreOrderBooks();
//       setBooks(list.items);
//     } catch (err) {
//       setError(err instanceof AdminApiError ? err.message : "Could not load pre-order books.");
//     }
//   }
// 
//   function selectBook(id: string) {
//     setSelectedId(id);
//     const book = books.find((b) => b.id === id);
//     if (!book) {
//       setForm(emptyForm);
//       return;
//     }
//     setForm({
//       title: book.title,
//       authorName: book.authorName,
//       description: book.description,
//       pageCount: book.pageCount ? String(book.pageCount) : "",
//       priceCents: String(book.priceCents),
//       compareAtPriceCents: book.compareAtPriceCents ? String(book.compareAtPriceCents) : "",
//       coverImageUrl: book.coverImageUrl,
//       coverImageAlt: book.coverImageAlt ?? "",
//       isActive: book.isActive,
//     });
//   }
// 
//   async function submit(event: FormEvent) {
//     event.preventDefault();
//     setSaving(true);
//     setMessage(null);
//     setError(null);
// 
//     const request = {
//       title: form.title,
//       authorName: form.authorName,
//       description: form.description,
//       pageCount: form.pageCount ? Number(form.pageCount) : null,
//       priceCents: Number(form.priceCents),
//       compareAtPriceCents: form.compareAtPriceCents ? Number(form.compareAtPriceCents) : null,
//       coverImageUrl: form.coverImageUrl,
//       coverImageAlt: form.coverImageAlt || undefined,
//       isActive: form.isActive,
//     };
// 
//     try {
//       const saved = selectedId
//         ? await updateAdminPreOrderBook(selectedId, request)
//         : await createAdminPreOrderBook(request);
// 
//       setMessage(`Saved "${saved.title}".`);
//       await loadBooks();
//       setSelectedId(saved.id);
//     } catch (err) {
//       setError(err instanceof AdminApiError ? err.message : "Could not save the pre-order book.");
//     } finally {
//       setSaving(false);
//     }
//   }
// 
//   return (
//     <AdminShell checking={checking}>
//       <main style={{ maxWidth: 560, margin: "40px auto", fontFamily: "system-ui, sans-serif" }}>
//         <h1 style={{ fontSize: 20, marginBottom: 8 }}>Pre-order book</h1>
//         <p style={{ color: "#555", marginBottom: 24 }}>
//           Create or edit the title the storefront is taking pre-orders for.
//         </p>
// 
//         {books.length > 0 ? (
//           <label style={{ display: "block", marginBottom: 20 }}>
//             Existing books
//             <select
//               value={selectedId}
//               onChange={(e) => selectBook(e.target.value)}
//               style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
//             >
//               <option value="">— New book —</option>
//               {books.map((book) => (
//                 <option key={book.id} value={book.id}>
//                   {book.title} {book.isActive ? "(active)" : ""}
//                 </option>
//               ))}
//             </select>
//           </label>
//         ) : null}
// 
//         <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
//           <label>
//             Title
//             <input
//               required
//               value={form.title}
//               onChange={(e) => setForm({ ...form, title: e.target.value })}
//               style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
//             />
//           </label>
// 
//           <label>
//             Author
//             <input
//               required
//               value={form.authorName}
//               onChange={(e) => setForm({ ...form, authorName: e.target.value })}
//               style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
//             />
//           </label>
// 
//           <label>
//             Description
//             <textarea
//               required
//               rows={4}
//               value={form.description}
//               onChange={(e) => setForm({ ...form, description: e.target.value })}
//               style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
//             />
//           </label>
// 
//           <label>
//             Page count
//             <input
//               type="number"
//               min={1}
//               value={form.pageCount}
//               onChange={(e) => setForm({ ...form, pageCount: e.target.value })}
//               style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
//             />
//           </label>
// 
//           <label>
//             Price (cents)
//             <input
//               required
//               type="number"
//               min={0}
//               value={form.priceCents}
//               onChange={(e) => setForm({ ...form, priceCents: e.target.value })}
//               style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
//             />
//           </label>
// 
//           <label>
//             Original price before discount (cents, optional)
//             <input
//               type="number"
//               min={0}
//               value={form.compareAtPriceCents}
//               onChange={(e) => setForm({ ...form, compareAtPriceCents: e.target.value })}
//               style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
//             />
//           </label>
// 
//           <label>
//             Cover image URL
//             <input
//               required
//               value={form.coverImageUrl}
//               onChange={(e) => setForm({ ...form, coverImageUrl: e.target.value })}
//               style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
//             />
//           </label>
// 
//           <label>
//             Cover image alt text
//             <input
//               value={form.coverImageAlt}
//               onChange={(e) => setForm({ ...form, coverImageAlt: e.target.value })}
//               style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}
//             />
//           </label>
// 
//           <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
//             <input
//               type="checkbox"
//               checked={form.isActive}
//               onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
//             />
//             Active (shown on the storefront)
//           </label>
// 
//           {message ? <p style={{ color: "green" }}>{message}</p> : null}
//           {error ? <p style={{ color: "crimson" }}>{error}</p> : null}
// 
//           <button type="submit" disabled={saving} style={{ padding: 10 }}>
//             {saving ? "Saving…" : selectedId ? "Save changes" : "Create pre-order book"}
//           </button>
//         </form>
//       </main>
//     </AdminShell>
//   );
// }
