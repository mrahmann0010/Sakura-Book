import { cva, type VariantProps } from "class-variance-authority";
import Image from "next/image";

import { cn, type Variants } from "@/lib/utils";

/**
 * Only same-origin sources go through `next/image`, and after the move to the
 * CDN that is almost none of them — which is the intended outcome, not a
 * regression to fix with a `remotePatterns` entry.
 *
 * `next/image` optimizes by fetching the source *server-side* and re-serving
 * it from `/_next/image`, so allowing the CDN host here would route every
 * cover back through this container and undo the edge delivery the storage
 * move was for. The bytes are better fetched from Cloudflare unoptimized than
 * from a single Next instance optimized. What that gives up is the automatic
 * resize and WebP re-encode, so the size a cover is uploaded at is the size
 * every visitor downloads — see the note on the upload limit in
 * admin-uploads.controller.ts.
 *
 * Left in place for the legacy `/api/files/…` covers uploaded before the move,
 * which are same-origin and do get optimized, and for a pasted publisher URL,
 * which stays absolute and external.
 */
function isOptimizable(src: string): boolean {
  return src.startsWith("/");
}

const coverRadius = cva("cover", {
  variants: {
    /* Radius steps with size: 8px on a real cover, 6px at 72px, 4px below. */
    radius: {
      xs: "rounded-xs",
      md: "rounded-md",
      control: "rounded-control",
    },
  },
  defaultVariants: { radius: "control" },
});

export type BookCoverProps = Variants<VariantProps<typeof coverRadius>> & {
  /** Cover art. Without it the fallback panel is drawn instead. */
  src?: string;
  title: string;
  author?: string;
  /**
   * `wordmark` keeps the book identifiable on its own — a tint panel carrying
   * the shop mark and the title. `hatch` is a plain placeholder, for when the
   * title is already set beside the cover.
   */
  fallback?: "wordmark" | "hatch";
  /** Sizing lives at the call site; the cover only owns the 2:3 crop. */
  className?: string;
  /**
   * Set on the one cover that is the page's LCP candidate — the book detail
   * page's own cover, or the first card of a grid above the fold. Skips
   * `next/image`'s default lazy-loading and preloads the image instead, so
   * this specific image isn't waiting on an IntersectionObserver to start
   * fetching. Left off everywhere else: marking every cover `priority` would
   * make the browser fetch a whole grid at once and help nothing.
   */
  priority?: boolean;
};

/**
 * Every cover in the system: a 2:3 crop with a 1px rule, so pale covers still
 * hold an edge on cream. No overlays, no duotone, no shadow.
 */
export function BookCover({
  src,
  title,
  author,
  fallback = "hatch",
  radius = "control",
  className,
  priority = false,
}: BookCoverProps) {
  const shape = cn(coverRadius({ radius }), className);

  if (src) {
    if (isOptimizable(src)) {
      return (
        <Image
          src={src}
          alt={`${title} — cover`}
          width={400}
          height={600}
          sizes="(max-width: 768px) 45vw, 240px"
          className={shape}
          priority={priority}
        />
      );
    }

    /* eslint-disable-next-line @next/next/no-img-element -- an admin-pasted
       publisher URL, on a host next/image isn't configured to optimize. */
    return <img src={src} alt={`${title} — cover`} className={shape} />;
  }

  if (fallback === "hatch") {
    return <span aria-hidden className={cn(shape, "cover-hatch block")} />;
  }

  return (
    <span aria-hidden className={cn(shape, "flex flex-col justify-between overflow-hidden p-5")}>
      <span className="eyebrow">Nihonova Books</span>
      <span className="block">
        <span className="text-20 text-ink block font-serif leading-tight">{title}</span>
        {author ? <span className="text-12 text-secondary mt-2 block">{author}</span> : null}
      </span>
    </span>
  );
}
