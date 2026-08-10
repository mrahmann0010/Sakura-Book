import { cn } from "@/lib/utils";

export type SkeletonProps = {
  className?: string;
  /**
   * Stagger index. The references offset each item by 120ms so a grid ripples
   * rather than pulsing as one block.
   */
  index?: number;
};

const STAGGER_MS = 120;

/**
 * A tinted bar that holds the exact shape of what is coming, so nothing shifts
 * when content lands. Size it with `className` at the call site — the shape is
 * the caller's knowledge, not the skeleton's.
 */
export function Skeleton({ className, index = 0 }: SkeletonProps) {
  return (
    <span
      aria-hidden
      className={cn("skeleton block", className)}
      style={index ? { animationDelay: `${index * STAGGER_MS}ms` } : undefined}
    />
  );
}

/** Stack of lines for a paragraph. The last line is short, as text is. */
export function SkeletonText({
  lines = 2,
  index = 0,
  className,
}: {
  lines?: number;
  index?: number;
  className?: string;
}) {
  return (
    <span className={cn("block", className)}>
      {Array.from({ length: lines }, (_, line) => (
        <Skeleton
          key={line}
          index={index}
          className={cn("h-3.5", line > 0 && "mt-2.5", line === lines - 1 && lines > 1 && "w-3/5")}
        />
      ))}
    </span>
  );
}
