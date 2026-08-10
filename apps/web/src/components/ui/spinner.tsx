import { spinner, type SpinnerVariants } from "@/lib/variants";
import { cn, type Variants } from "@/lib/utils";

export type SpinnerProps = Variants<SpinnerVariants> & {
  className?: string;
  /**
   * Announced to screen readers. The reference always pairs the spinner with a
   * visible word ("Checking status…"); when it does, pass `label={null}` on the
   * spinner so the text is not read twice.
   */
  label?: string | null;
};

export function Spinner({
  size = "md",
  tone = "default",
  label = "Loading",
  className,
}: SpinnerProps) {
  return (
    <span
      role={label ? "status" : undefined}
      aria-hidden={label ? undefined : true}
      className={cn(spinner({ size, tone }), className)}
    >
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}

/** Spinner with the visible waiting line beside it, as the reference draws it. */
export function LoadingLine({
  children = "Loading…",
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("text-13 text-secondary flex items-center gap-5", className)}>
      <Spinner label={null} />
      {children}
    </p>
  );
}
