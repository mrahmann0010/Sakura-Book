"use client";

import { useState } from "react";
import type {
  AdminWaitlistBook,
  AdminWaitlistEntry,
  AdminWaitlistUpdateRequest,
} from "@sakura/contracts";

import { Button, Eyebrow, Input, Modal, Select, Textarea } from "@/components/ui";

/* --------------------------------------------------------------------------
   Correcting one entry.

   A waitlist row is typed by a member of the public on a phone, and then
   amended over the phone: wrong book picked from the list, one copy asked for
   when the household wanted three, a digit missed in the number the whole
   thing depends on. Until this dialog the panel could edit exactly one of
   those — the staff note — and everything else needed a SQL client.

   It sends only the fields that actually changed. That is not a nicety: the
   API refuses a book or quantity change while an invite is live, so a form
   that PATCHed all six fields every time would start failing on a note edit
   the moment somebody was holding a copy.
   -------------------------------------------------------------------------- */

export type WaitlistEntryDialogProps = {
  /** Mounted only while open, so every field below is a `useState` seed rather
   *  than an effect re-syncing against the row underneath it. */
  entry: AdminWaitlistEntry;
  /** The catalog, for the title picker. */
  books: AdminWaitlistBook[];
  busy?: boolean;
  /** Why the last save did not stick. Rendered in here rather than left to the
   *  page's banner, which the modal covers — a refusal nobody can read is the
   *  same as a button that silently does nothing. */
  error?: string | null;
  onClose: () => void;
  onSubmit: (patch: AdminWaitlistUpdateRequest) => Promise<void> | void;
};

const LANGUAGES = [
  { value: "bn", label: "Bangla" },
  { value: "en", label: "English" },
  { value: "ja", label: "Japanese" },
];

export function WaitlistEntryDialog({
  entry,
  books,
  busy = false,
  error = null,
  onClose,
  onSubmit,
}: WaitlistEntryDialogProps) {
  const [bookId, setBookId] = useState(entry.bookId ?? "");
  const [quantity, setQuantity] = useState(String(entry.quantity));
  const [customerName, setCustomerName] = useState(entry.customerName);
  const [customerEmail, setCustomerEmail] = useState(entry.customerEmail);
  const [customerPhone, setCustomerPhone] = useState(entry.customerPhone);
  const [locale, setLocale] = useState(entry.locale);
  const [internalNote, setInternalNote] = useState(entry.internalNote ?? "");

  /* The same rule the API enforces, drawn rather than discovered. Both fields
     together *are* the hold: a live invite reserves this many copies of this
     title against the book's open release, so changing either under it moves
     copies between budgets silently. Disabled with the reason attached, since
     a greyed field with no explanation reads as a broken screen. */
  const converted = entry.lane === "CONVERTED" || entry.invite?.usedAt != null;
  const holding = entry.lane === "INVITED";
  const holdLocked = converted || holding;

  /* Entries whose book was deleted keep their snapshot and lose the id — the
     FK is `set null`. The picker would otherwise silently read as "General
     waitlist" and offer to save that as a deliberate choice. */
  const orphaned = entry.bookId === null && entry.bookTitle !== null;

  function submit() {
    const patch: AdminWaitlistUpdateRequest = {};

    if (!holdLocked) {
      const nextBookId = bookId || null;
      if (nextBookId !== entry.bookId) patch.bookId = nextBookId;

      const nextQuantity = Number(quantity);
      if (Number.isFinite(nextQuantity) && nextQuantity !== entry.quantity) {
        patch.quantity = nextQuantity;
      }
    }

    if (customerName.trim() !== entry.customerName) patch.customerName = customerName.trim();
    if (customerEmail.trim() !== entry.customerEmail) patch.customerEmail = customerEmail.trim();
    if (customerPhone.trim() !== entry.customerPhone) patch.customerPhone = customerPhone.trim();
    if (locale !== entry.locale) patch.locale = locale as "bn" | "en" | "ja";
    if (internalNote !== (entry.internalNote ?? "")) patch.internalNote = internalNote;

    /* Nothing moved — close rather than send a PATCH the contract rejects for
       being empty. Saving an untouched form is a normal thing to do. */
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }

    void onSubmit(patch);
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title="Edit entry"
      /* One line, and the identifying one: which row this is. What the dialog
         does is obvious from the fields, and a paragraph explaining it only
         pushes them further down a screen that is already tight on a phone. */
      description={
        <>
          <span className="text-ink font-medium">{entry.customerName}</span> · signed up{" "}
          {new Date(entry.signedUpAt).toLocaleDateString()} via {entry.source}
        </>
      }
      actions={
        <>
          <Button type="button" loading={busy} onClick={submit}>
            Save changes
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      {/* Two columns from `sm` up, one below. Seven stacked fields ran past the
          bottom of a laptop screen; paired up, the whole form is four rows and
          the buttons stay in view. The two sections are the two questions a
          correction is ever about — what they asked for, and how to reach
          them — so the split is the one staff are already thinking in. */}
      <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
        {error ? (
          <p className="text-13.5 text-clay-deep font-medium sm:col-span-2">{error}</p>
        ) : null}

        {holdLocked ? (
          <p className="rounded-control border-rule bg-tint text-caption text-secondary border px-3 py-2 sm:col-span-2">
            {converted
              ? "This entry became an order, so its book and quantity are the record of what was bought. Contact details can still be corrected."
              : "Holding a copy against an open release. To change the book or quantity, Remove this entry — which takes the invite back — then Restore it."}
          </p>
        ) : null}

        <Eyebrow className="text-muted sm:col-span-2">The request</Eyebrow>

        <Select
          label="Waiting on"
          hint={
            orphaned ? `Recorded as “${entry.bookTitle}”, no longer in the catalog.` : undefined
          }
          value={bookId}
          disabled={busy || holdLocked}
          onChange={(event) => setBookId(event.target.value)}
          fieldClassName="sm:col-span-2"
        >
          <option value="">General waitlist (no book)</option>
          {books.map((book) => (
            <option key={book.id} value={book.id}>
              {book.title}
            </option>
          ))}
        </Select>

        <Input
          label="Copies wanted"
          type="number"
          min={1}
          max={20}
          value={quantity}
          disabled={busy || holdLocked}
          onChange={(event) => setQuantity(event.target.value)}
        />

        <Select
          label="Language"
          hint="Which language the restock text goes out in."
          options={LANGUAGES}
          value={locale}
          disabled={busy}
          onChange={(event) => setLocale(event.target.value)}
        />

        {/* A rule rather than more whitespace: the gap that would read as a
            section break at this density is a gap that costs a row. */}
        <Eyebrow className="border-rule text-muted border-t pt-4 sm:col-span-2">
          Who is waiting
        </Eyebrow>

        <Input
          label="Name"
          value={customerName}
          disabled={busy}
          onChange={(event) => setCustomerName(event.target.value)}
        />

        <Input
          label="Phone"
          hint="Where the invite text goes."
          inputMode="tel"
          className="font-mono"
          value={customerPhone}
          disabled={busy}
          onChange={(event) => setCustomerPhone(event.target.value)}
        />

        <Input
          label="Email"
          type="email"
          value={customerEmail}
          disabled={busy}
          onChange={(event) => setCustomerEmail(event.target.value)}
          fieldClassName="sm:col-span-2"
        />

        <Textarea
          label="Internal note"
          hint="Staff only — never shown to the customer."
          rows={2}
          maxLength={2000}
          value={internalNote}
          disabled={busy}
          onChange={(event) => setInternalNote(event.target.value)}
          fieldClassName="sm:col-span-2"
        />
      </div>
    </Modal>
  );
}
