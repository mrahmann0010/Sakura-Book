import { cva, type VariantProps } from "class-variance-authority";

import { cn, type Variants } from "@/lib/utils";

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
}: BookCoverProps) {
  const shape = cn(coverRadius({ radius }), className);

  if (src) {
    /* eslint-disable-next-line @next/next/no-img-element -- covers come from
       arbitrary publisher hosts; next/image config is an app-level decision. */
    return <img src={src} alt={`${title} — cover`} className={shape} />;
  }

  if (fallback === "hatch") {
    return <span aria-hidden className={cn(shape, "cover-hatch block")} />;
  }

  return (
    <span
      aria-hidden
      className={cn(shape, "flex flex-col justify-between overflow-hidden p-5")}
    >
      <span className="eyebrow">Marginalia</span>
      <span className="block">
        <span className="block font-serif text-20 leading-tight text-ink">
          {title}
        </span>
        {author ? (
          <span className="mt-2 block text-12 text-secondary">{author}</span>
        ) : null}
      </span>
    </span>
  );
}
