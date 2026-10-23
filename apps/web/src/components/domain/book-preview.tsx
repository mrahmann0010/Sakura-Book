"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { BookOpenIcon, Button, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

/* pdf.js is around half a megabyte and belongs to nobody who does not open a
   sample, so the reader is a separate chunk fetched on the click. `ssr: false`
   because it rasterises to a <canvas> and there is nothing for the server to
   render — and the dialog it lives in does not exist until a browser event
   anyway. The placeholder holds the panel's shape so the frame does not appear
   empty and then jump. */
const PdfReader = dynamic(() => import("./pdf-reader").then((m) => m.PdfReader), {
  ssr: false,
  loading: () => (
    <div className="bg-tint flex h-full items-center justify-center">
      <Spinner />
    </div>
  ),
});

/* --------------------------------------------------------------------------
   "Read a sample" — the reader, and the button that opens it.

   Two exports, because the book page opens this from the cover itself rather
   than from a button (see CoverPreview): `BookPreviewDialog` is the reader and
   owns every behaviour that belongs to a dialog, `BookPreview` is the plain
   button trigger for anywhere a cover is not available to carry it. Splitting
   them is what lets a second trigger exist without a second copy of the
   Escape / scroll-lock / focus-return logic, which is the part that is easy to
   get subtly wrong.

   Not built on <Modal>: that component documents itself as "the same card,
   centred on a dimmed page" and caps at `max-w-measure` (66ch), which is the
   right frame for a sentence and a pair of buttons and the wrong one for a
   page of a book. A reader wants the opposite proportions — as much height as
   the viewport will give — so this owns its own panel and keeps Modal's
   behaviour (Escape, backdrop click, scroll lock, restored focus) rather than
   its dimensions.
   -------------------------------------------------------------------------- */

/**
 * The sample reader itself. Mount it only while it should be open — it has no
 * `open` prop on purpose, so that mounting is the thing that opens it and the
 * cleanup below is the thing that closes it, however it was closed.
 */
export function BookPreviewDialog({
  /**
   * Where to fetch the sample from — already rewritten onto this app's own
   * `/api/files/…` path by the caller (lib/storage-url.ts), not the storage
   * provider's URL. It is both what the reader loads and what the
   * "open in a new tab" link points at, so passing a raw storage URL here
   * would put it in the page's href where anyone can read it.
   */
  pdfUrl,
  /** Titles the reader, so the dialog says which book this is a sample of. */
  bookTitle,
  onClose,
}: {
  pdfUrl: string;
  bookTitle: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  /**
   * Whatever had focus when the dialog opened, so closing hands it back.
   *
   * Captured from `document.activeElement` rather than handed down from a ref
   * on the trigger: the keyboard should return to wherever it actually was,
   * which is the trigger when clicked and could be something else when the
   * dialog is opened any other way — and with two different triggers now, a
   * prop would have to be threaded through both.
   */
  const returnFocusRef = useRef<HTMLElement | null>(null);
  /**
   * The latest `onClose`, so the effect below can stay on an empty dependency
   * list. Callers pass an inline arrow; with `onClose` as a dependency the
   * effect would tear down and re-run on every render of the parent, which
   * means releasing and re-taking the scroll lock mid-read.
   */
  const onCloseRef = useRef(onClose);
  /* Kept current in an effect of its own rather than assigned during render:
     a ref write while rendering is not safe under concurrent rendering, which
     may render a tree it then throws away. This runs on every commit, with no
     dependency list, which is exactly the point. */
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };

    document.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();

    /* Same technique as Modal: remember the value rather than assuming it was
       empty, so closing restores whatever the page had rather than clearing an
       overflow another component set. */
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      /* Focus goes back here, in the teardown, rather than in a `close`
         handler: there are three ways out of this dialog — Escape, the
         backdrop, the Close button — and a handler has to remember for each
         one. Escape did not, and dropped the keyboard on <body>. The cleanup
         runs for all three and for an unmount, so there is nothing to
         remember. */
      returnFocusRef.current?.focus();
    };
  }, []);

  return (
    <div
      className="bg-overlay fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${t("book.preview.title")} — ${bookTitle}`}
        tabIndex={-1}
        className={cn(
          "bg-surface flex flex-col outline-none",
          /* Full-bleed on a phone, where every pixel of height is a line
             of the book; an inset sheet from the tablet floor up. */
          "sm:rounded-sheet sm:border-rule h-full w-full sm:h-[min(90vh,60rem)] sm:max-w-4xl sm:border",
        )}
      >
        <div className="border-rule flex items-start justify-between gap-4 border-b px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-19 text-ink truncate font-serif">{bookTitle}</h2>
            <p className="text-12 text-secondary mt-0.5">{t("book.preview.lede")}</p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            {t("book.preview.close")}
          </Button>
        </div>

        {/* `min-h-0` so the reader is bounded by the panel and scrolls
            inside itself — without it a flex child sized by its content
            pushes the header off the top of a short viewport. */}
        <div className="min-h-0 flex-1">
          {/* Was an <iframe src={pdfUrl}>, which asks the browser to supply
              a PDF viewer. Desktop browsers ship one and phones do not:
              Android Chrome left the frame blank and iOS Safari showed page
              one and refused to scroll, so the sample was legible on the
              devices least likely to be buying from it. PdfReader draws the
              pages itself, which is the same picture everywhere. */}
          <PdfReader url={pdfUrl} className="h-full w-full" />
        </div>

        <div className="border-rule flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3.5">
          {/* Worded as a question, not an assertion. The embed works on
              most desktop browsers and does not on others — iOS Safari
              shows page one and refuses to scroll — and a line that
              declares "this browser will not show it" is wrong half the
              time it is read, sitting directly under a reader that plainly
              is showing it. The link beside it is the whole sample
              everywhere. */}
          <p className="text-11.5 text-muted max-w-measure-lede">{t("book.preview.fallback")}</p>
          <a
            href={pdfUrl}
            target="_blank"
            rel="noreferrer"
            className="text-13 text-clay hover:text-clay-deep shrink-0 underline"
          >
            {t("book.preview.openInNewTab")}
          </a>
        </div>
      </div>
    </div>
  );
}

/**
 * The button trigger. The book detail page does not use this any more — there
 * the cover itself opens the sample (CoverPreview), which is both a far bigger
 * target and the thing a reader instinctively reaches for. Kept for any
 * surface that shows a sample without a cover beside it.
 */
export function BookPreview({
  /** Null when the shop has not uploaded a sample; renders nothing. */
  pdfUrl,
  bookTitle,
  /**
   * How loud the trigger is. Ghost by default — it is the quieter question
   * wherever this is dropped into a dense layout — but `soft` where the
   * sample is a real part of the decision.
   */
  variant = "ghost",
  className,
}: {
  pdfUrl: string | null;
  bookTitle: string;
  variant?: "ghost" | "secondary" | "soft";
  className?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  /* A book with no sample uploaded gets no button at all, rather than a
     disabled one: "you cannot read this" is not information a shopper needs,
     and a dead control competes with the live ones beside it. */
  if (!pdfUrl) return null;

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size="md"
        block
        /* An open book, not a closed one: a page that carries a cover image
           tells the two shapes apart at 18px only by the spine down the
           middle of this one. */
        leading={<BookOpenIcon />}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={className}
      >
        {t("book.preview.action")}
      </Button>

      {open ? (
        <BookPreviewDialog pdfUrl={pdfUrl} bookTitle={bookTitle} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
