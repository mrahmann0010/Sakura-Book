import { stepper, stepperButton } from "@/lib/variants";
import { cn } from "@/lib/utils";

export type StepperProps = {
  value: number;
  onChange?: (value: number) => void;
  min?: number;
  max?: number;
  /** Names the control for assistive tech — "Quantity, The Hearing Trumpet". */
  label: string;
  /** The border goes ink once the row has been touched. */
  engaged?: boolean;
  disabled?: boolean;
  className?: string;
};

/**
 * Bordered pill: − n +. Controlled, so the same stepper serves a cart line, a
 * quantity field on a detail page, or an optimistic list without owning state.
 */
export function Stepper({
  value,
  onChange,
  min = 1,
  max = 99,
  label,
  engaged,
  disabled,
  className,
}: StepperProps) {
  const step = (next: number) => () => onChange?.(next);

  return (
    <span
      role="group"
      aria-label={label}
      className={cn(stepper({ engaged }), className)}
    >
      <button
        type="button"
        className={stepperButton}
        onClick={step(value - 1)}
        disabled={disabled || value <= min}
        aria-label={`Decrease ${label}`}
      >
        −
      </button>
      <span aria-live="polite" className="min-w-count text-center text-13.5 text-ink">
        {value}
      </span>
      <button
        type="button"
        className={stepperButton}
        onClick={step(value + 1)}
        disabled={disabled || value >= max}
        aria-label={`Increase ${label}`}
      >
        +
      </button>
    </span>
  );
}
