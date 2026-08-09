import Link from "next/link";

import { badge } from "@/lib/variants";
import { flagLabels, type Book } from "@/lib/books";
import { cn } from "@/lib/utils";

/* --------------------------------------------------------------------------
   Cover

   No cover art exists yet, so every card uses the documented fallback: a
   panel carrying the wordmark as a mono eyebrow, with the title and author
   set in Lora at the foot. The hatch is the one sanctioned use of #E8E3D7.
   Sitting on a tinted card, the panel takes the surface white so pale covers
   still hold their edge.
   -------------------------------------------------------------------------- */

function CoverFallback({ book }: { book: Book }) {
  return (
    <div
      className="cover relative flex flex-col justify-between overflow-hidden bg-surface p-3.5"
      style={{
        backgroundImage:
          "repeating-linear-gradient(135deg, #e8e3d7 0 1px, transparent 1px 9px)",
      }}
      aria-hidden
    >
      <span className="eyebrow">Marginalia</span>
      <span className="flex flex-col gap-1">
        <span className="font-serif text-14.5 leading-[1.25] text-ink">
          {book.title}
        </span>
        <span className="font-serif text-11 italic text-secondary">
          {book.author}
        </span>
      </span>
    </div>
  );
}

/* --------------------------------------------------------------------------
   BookCard

   Hover is an ink outline at 6px offset — nothing else moves (principle 04).
   The title anchor stretches over the whole card, so the card is one target;
   quick view sits above it as the single nested control.
   -------------------------------------------------------------------------- */

export function BookCard({
  book,
  showFlag = true,
  className,
}: {
  book: Book;
  /** The staff-picks shelf runs the same card without badges. */
  showFlag?: boolean;
  className?: string;
}) {
  const flag = showFlag ? book.flag : undefined;

  return (
    <article
      className={cn(
        "group relative flex flex-col rounded-container bg-tint p-5",
        "outline-1 outline-offset-[6px] outline-transparent",
        "transition-[outline-color] duration-150",
        "hover:outline-ink has-[a:focus-visible]:outline-ink",
        !book.inStock && "opacity-55",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        {flag ? (
          <span
            className={badge({
              tone: flag === "editors-pick" ? "accent" : "neutral",
            })}
          >
            {flagLabels[flag]}
          </span>
        ) : (
          <span aria-hidden />
        )}

        <Link
          href={`/books/${book.slug}?view=quick`}
          className={cn(
            "relative z-10 -m-1 flex size-9 shrink-0 items-center justify-center",
            "rounded-control border border-rule bg-surface text-muted",
            "transition-colors duration-150 hover:border-ink hover:text-ink",
          )}
          aria-label={`Quick view — ${book.title}`}
        >
          <svg
            viewBox="0 0 20 20"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden
          >
            <path d="M6 14 14 6M7.5 6H14v6.5" />
          </svg>
        </Link>
      </div>

      <div className="mx-auto mt-4 w-[62%] min-w-[112px]">
        <CoverFallback book={book} />
      </div>

      <div className="hairline mt-6 pt-4">
        <h3 className="text-18 leading-[1.28]">
          <Link href={`/books/${book.slug}`} className="before:absolute before:inset-0">
            {book.title}
          </Link>
        </h3>
        <p className="mt-1.5 font-serif text-caption italic text-secondary">
          {book.author}
        </p>
        <p className="mt-1 text-caption text-body">
          {book.inStock ? book.price : "Out of stock"}
        </p>
      </div>
    </article>
  );
}
