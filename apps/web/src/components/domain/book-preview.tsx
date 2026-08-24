"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, Spinner } from "@/components/ui";
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
   "Read a sample" — the button on the book page, and the reader it opens.

   Not built on <Modal>: that component documents itself as "the same card,
   centred on a dimmed page" and caps at `max-w-measure` (66ch), which is the
   right frame for a sentence and a pair of buttons and the wrong one for a
   page of a book. A reader wants the opposite proportions — as much height as
   the viewport will give — so this owns its own panel and keeps Modal's
   behaviour (Escape, backdrop click, scroll lock, restored focus) rather than
   its dimensions.
   -------------------------------------------------------------------------- */

export function BookPreview({
  /**
   * Where to fetch the sample from — already rewritten onto this app's own
   * `/api/files/…` path by the caller (lib/storage-url.ts), not the storage
   * provider's URL. It is both what the reader loads and what the
   * "open in a new tab" link points at, so passing a raw storage URL here
   * would put it in the page's href where anyone can read it.
   *
   * Null when the shop has not uploaded a sample; renders nothing.
   */
  pdfUrl,
  /** Titles the reader, so the dialog says which book this is a sample of. */
  bookTitle,
  className,
}: {
  pdfUrl: string | null;
  bookTitle: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  /**
   * Whatever had focus when the dialog opened, so closing hands it back.
   *
   * Captured from `document.activeElement` rather than a ref on the button:
   * `Button` is typed `ComponentPropsWithoutRef`, and this is the better
   * question anyway — the keyboard should return to wherever it actually was,
   * which is the button when clicked and could be something else when the
   * dialog is opened any other way.
   */
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
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
  }, [open]);

  /* A book with no sample uploaded gets no button at all, rather than a
     disabled one: "you cannot read this" is not information a shopper needs,
     and a dead control on the buy card competes with the two live ones. */
  if (!pdfUrl) return null;

  function close() {
    setOpen(false);
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="md"
        block
        aria-haspopup="dialog"
        onClick={(event) => {
          returnFocusRef.current = event.currentTarget;
          setOpen(true);
        }}
        className={className}
      >
        {t("book.preview.action")}
      </Button>

      {open ? (
        <div
          className="bg-overlay fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-6"
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
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
              <Button type="button" variant="ghost" size="sm" onClick={close}>
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
              <p className="text-11.5 text-muted max-w-measure-lede">
                {t("book.preview.fallback")}
              </p>
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
      ) : null}
    </>
  );
}
