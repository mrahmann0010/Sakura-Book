"use client";

import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

/* --------------------------------------------------------------------------
   A PDF reader that renders the pages itself.

   This replaced an <iframe src={pdf}>, which is not a PDF viewer — it is a
   request that the browser produce one. Desktop Chrome, Firefox and Safari all
   ship a plugin that answers; phones do not. Android Chrome renders the frame
   blank or offers a download, and iOS Safari paints page one and will not
   scroll it. So the sample was readable on exactly the devices whose owners
   were least likely to be deciding whether to buy, and unreadable on the rest.

   pdf.js rasterises each page to a <canvas>, which is the same picture on every
   engine because we are the ones drawing it. The costs that buys, and how each
   is paid, are the comments below.
   -------------------------------------------------------------------------- */

/**
 * How many pages either side of the viewport keep a painted canvas.
 *
 * Not a scroll-smoothness tuning knob — a memory ceiling, and the reason this
 * component windows at all. iOS Safari caps the total backing store of all live
 * canvases at a few hundred megabytes and discards or blanks them past it, so a
 * thirty-page sample painted eagerly at device resolution does not render
 * slowly, it renders and then goes white. Two neighbours is enough that a page
 * is ready before a fast scroll reaches it and few enough that the ceiling is
 * never in sight.
 */
const RENDER_WINDOW = 2;

/**
 * Ceiling on the device-pixel multiplier.
 *
 * Phones report 3 and 4. The third and fourth pixel are past what the eye
 * resolves on printed text at reading distance, and cost quadratically in both
 * canvas memory and rasterising time — which on a mid-range Android is the
 * difference between a page appearing and a page appearing eventually.
 */
const MAX_PIXEL_RATIO = 2;

/**
 * The library, imported once per page load and shared by every reader opened.
 *
 * A module-level promise rather than a per-mount import: pdf.js is ~500KB and
 * the point of loading it lazily is that a shopper who never opens a sample
 * never pays for it. A shopper who opens two should not pay twice.
 *
 * The legacy build, not the default one. The default targets browsers with
 * `Promise.withResolvers` — Safari 17.4, Chrome 119, both from late 2023. The
 * legacy build is compiled down and polyfilled, and this shop's readers are on
 * Android handsets whose Chrome is whatever the vendor last shipped. The
 * difference is some tens of kilobytes in a chunk that already loads on demand;
 * the difference the other way is a blank dialog with a console error on a
 * phone nobody testing this owns.
 */
let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

function loadPdfjs() {
  pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((pdfjs) => {
    /* Served from public/ by scripts/copy-pdfjs-assets.mjs. See that file for
       why these are fixed paths and not bundler-emitted asset URLs. */
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
    return pdfjs;
  });
  return pdfjsPromise;
}

type Sheet = {
  page: PDFPageProxy;
  /** Page box at scale 1, in PDF points — the ratio the layout box is sized by. */
  width: number;
  height: number;
};

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; doc: PDFDocumentProxy; sheets: Sheet[] };

export function PdfReader({ url, className }: { url: string; className?: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ status: "loading" });
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  /** Page width in CSS pixels; 0 until measured, which gates the first paint. */
  const [width, setWidth] = useState(0);

  useEffect(() => {
    /* Guards the async gaps below. Opening and closing the dialog quickly, or
       React 19's development double-invoke, both land here mid-load, and
       setting state on the torn-down mount would show one book's sample inside
       another's frame. */
    let live = true;
    let doc: PDFDocumentProxy | null = null;

    void (async () => {
      try {
        const pdfjs = await loadPdfjs();
        const task = pdfjs.getDocument({
          url,
          /* A same-origin `/api/files/…` path, not the storage URL: callers
             route it through lib/storage-url.ts. That started out as a way to
             keep the storage provider out of the page source, and it also
             removed the one fragile thing about this fetch — it used to be
             cross-origin and to work only because the bucket answered with
             `Access-Control-Allow-Origin: *`, so turning the bucket private or
             moving it anywhere that omits the header broke the reader while
             leaving the "open in a new tab" link working. Nothing to depend on
             now; the route handler is on this app's own origin. */
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
          /* pdf.js will otherwise use `eval` to JIT some font programs. It is
             a documented opt-out and costs a little font-rendering speed on
             unusual files; it is set because the day this shop adopts a CSP
             worth having is the day that CSP omits `unsafe-eval`, and a
             preview that breaks on a header nobody connected to it is a bad
             afternoon. */
          isEvalSupported: false,
        });
        doc = await task.promise;
        if (!live) return;

        /* Every page proxy up front, so the scroll container can be given its
           true height immediately. The alternative — growing the list as pages
           resolve — moves the content under the reader's thumb while they are
           already reading page one. getPage is served from the document's own
           cache and does not refetch. */
        const sheets = await Promise.all(
          Array.from({ length: doc.numPages }, async (_, index) => {
            const page = await doc!.getPage(index + 1);
            const { width: w, height: h } = page.getViewport({ scale: 1 });
            return { page, width: w, height: h } satisfies Sheet;
          }),
        );
        if (!live) return;

        setState({ status: "ready", doc, sheets });
      } catch {
        /* One state for every failure — offline, 404, CORS, a file that is not
           a PDF. The reader cannot act differently on any of them and the
           message underneath offers the one thing that might work regardless,
           so distinguishing them would be detail for its own sake. */
        if (live) setState({ status: "error" });
      }
    })();

    return () => {
      live = false;
      /* Tears down the worker and frees the parsed document. Skipping this
         leaks a worker thread and the whole page cache per open — cheap to
         miss, because nothing visibly breaks until a reader has opened a few
         samples and the tab starts to swim. */
      void doc?.destroy();
    };
  }, [url]);

  /* Measured rather than assumed: this reader is full-bleed on a phone and an
     inset sheet on a tablet, and the pages are rendered to fit the width they
     actually get. useLayoutEffect so the first measurement lands before paint
     and the pages do not visibly resize once. */
  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) return;

    const measure = () => {
      /* The unpadded content element, not the scroll container: its width is
         already the width a page may occupy, so nothing here has to know what
         padding the container was given. clientWidth rather than
         getBoundingClientRect because it excludes the scrollbar, which is the
         difference between fitting the page and provoking a horizontal one. */
      setWidth(element.clientWidth);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [state.status]);

  return (
    <div
      ref={scrollRef}
      /* `overscroll-contain` so reaching the last page does not hand the scroll
         to the page behind the dialog, and `-webkit-overflow-scrolling` via
         Tailwind's touch utility for momentum on iOS. */
      className={cn("bg-tint touch-pan-y overflow-y-auto overscroll-contain", className)}
    >
      {state.status === "loading" ? (
        <div className="flex h-full items-center justify-center p-10">
          <Spinner label={t("book.preview.loading")} />
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className="flex h-full items-center justify-center p-10">
          <p className="text-13 text-secondary max-w-measure-lede text-center text-balance">
            {t("book.preview.error")}
          </p>
        </div>
      ) : null}

      {state.status === "ready" ? (
        <div className="p-4">
          <div ref={contentRef} className="flex flex-col items-center gap-4">
            {state.sheets.map((sheet, index) => (
              <PdfSheet
                key={index}
                sheet={sheet}
                pageNumber={index + 1}
                pageCount={state.sheets.length}
                width={width}
                root={scrollRef}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * One page: a correctly-sized box always, a painted canvas only while near.
 *
 * The box exists from the first render at the page's true aspect ratio, so the
 * scrollbar is honest before anything has been rasterised and no page ever
 * changes height under the reader.
 */
function PdfSheet({
  sheet,
  pageNumber,
  pageCount,
  width,
  root,
}: {
  sheet: Sheet;
  pageNumber: number;
  pageCount: number;
  width: number;
  root: React.RefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation();
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);

  const displayWidth = Math.max(0, width);
  const displayHeight = displayWidth * (sheet.height / sheet.width);

  useEffect(() => {
    const element = boxRef.current;
    if (!element) return;

    /* `rootMargin` in percent is resolved against the root's own height, so
       RENDER_WINDOW is expressed in viewport-fuls rather than pixels and means
       the same thing on a phone and on a desktop sheet. */
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      root: root.current,
      rootMargin: `${RENDER_WINDOW * 100}% 0px`,
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [root]);

  /**
   * Paint when near, and release the memory when not.
   *
   * `page.render` is called synchronously here and its RenderTask captured
   * before anything is awaited. That ordering is the whole point: the task is
   * what `cancel()` acts on, and an earlier version of this assigned it from
   * the resolved promise — by which time the render had already finished and
   * cancelling it did nothing at all. A fling through a thirty-page sample
   * would then rasterise all thirty, each one holding the worker while the
   * page the reader actually stopped on waited its turn.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!visible || displayWidth <= 0) {
      /* Scrolled out of the window: drop the backing store. Zeroing the
         attributes is what actually frees it — hiding the element or clearing
         the context does not, and the canvas keeps its megabytes until it is
         collected, which on iOS is well after the ceiling has been hit. */
      canvas.width = 0;
      canvas.height = 0;
      canvas.style.opacity = "0";
      return;
    }

    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    const viewport = sheet.page.getViewport({ scale: (displayWidth / sheet.width) * ratio });

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    let live = true;
    const task = sheet.page.render({ canvas, viewport });

    task.promise.then(
      () => {
        /* The fade is set on the element rather than held in React state.
           Whether a canvas has been painted is a fact about the canvas, it
           changes on every scroll, and routing it through a re-render would
           mean one render pass per page per fling for something CSS already
           does on the compositor. */
        if (live) canvas.style.opacity = "1";
      },
      /* A cancelled render rejects, and so does a page that fails to
         rasterise. Neither is worth a message: the box keeps its shape and its
         number, which is a quieter "not here" than an error card wedged into
         the middle of a book. */
      () => {},
    );

    return () => {
      live = false;
      task.cancel();
    };
  }, [visible, displayWidth, sheet]);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        ref={boxRef}
        className="bg-surface border-rule w-full max-w-full border shadow-sm"
        style={{ width: displayWidth || undefined, height: displayHeight || undefined }}
      >
        <canvas
          ref={canvasRef}
          /* The canvas is sized in device pixels by the renderer and scaled
             back down to CSS pixels here — that ratio is the whole reason the
             text is sharp on a phone. Starts transparent and is faded in by
             the effect above once there is something on it, so an unpainted
             page reads as blank paper rather than as a flash of grey. */
          style={{ opacity: 0 }}
          className="h-full w-full transition-opacity duration-200"
        />
      </div>
      <p className="text-11.5 text-muted tabular-nums">
        {/* `total`, not `count`: i18next reads `count` as the plural selector
            and would look for `page_one`/`page_other` that do not exist. */}
        {t("book.preview.page", { page: pageNumber, total: pageCount })}
      </p>
    </div>
  );
}
