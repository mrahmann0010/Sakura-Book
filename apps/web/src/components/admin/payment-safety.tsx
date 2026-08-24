import type { AdminOrderVerificationState, ReceiptUniqueness } from "@sakura/contracts";

import { cn } from "@/lib/utils";

/* --------------------------------------------------------------------------
   The two payment-safety indicators, rendered once and used in both places
   the panel needs them: the queue row and the order detail's Payment card.

   Two indicators rather than one combined "verified" badge, and the reason is
   the whole point of them. A reused receipt is genuine at the gateway — it is
   a real payment, for the right amount, that another order has already been
   granted against — so a single badge would render the dangerous case as
   "verified" and hide the only thing wrong with it. Uniqueness and
   verification are independent facts and staff need both.

   Colour follows DESIGN_SYSTEM §2.3: there is no green here, success is ink,
   clay is reserved for the case where money is actually at risk, and clay-deep
   carries the "we cannot tell you yet" states. Every one of them carries its
   word, so the colour is never the only signal.
   -------------------------------------------------------------------------- */

const INDICATOR = "inline-flex items-center rounded-md px-2 py-1 font-mono text-10 tracking-eyebrow uppercase whitespace-nowrap";

const RECEIPT_TONES: Record<ReceiptUniqueness["state"], { label: string; className: string }> = {
  /** Ink, not green — the design system has no green, and this is the good case. */
  UNIQUE: { label: "Unique", className: "bg-tint text-ink" },
  /** The only indicator that takes clay: this is the one where money is at risk. */
  DUPLICATE: { label: "Duplicate", className: "bg-surface border border-clay text-clay" },
  MISSING: { label: "No receipt", className: "bg-tint text-clay-deep" },
  /** Cash on delivery. Rendered as nothing at all — see ReceiptBadge. */
  NOT_APPLICABLE: { label: "", className: "" },
};

/**
 * Whether this order's receipt is its own.
 *
 * Renders nothing for cash on delivery. A COD order has no receipt to be
 * unique and never will, so a badge saying so would be a permanent column of
 * "not applicable" down a queue that is mostly COD — noise that trains staff
 * to stop reading the column the one morning it says something.
 */
export function ReceiptBadge({
  receipt,
  className,
}: {
  receipt: ReceiptUniqueness;
  className?: string;
}) {
  if (receipt.state === "NOT_APPLICABLE") return null;

  const tone = RECEIPT_TONES[receipt.state];

  return (
    <span
      className={cn(INDICATOR, tone.className, className)}
      // The badge is two words wide; the useful sentence goes to assistive
      // tech and to the hover, where it does not cost a table column.
      title={
        receipt.claimedByOrderNumber
          ? `This receipt is already on order ${receipt.claimedByOrderNumber}`
          : undefined
      }
    >
      {tone.label}
    </span>
  );
}

const VERIFICATION_TONES: Record<
  AdminOrderVerificationState["outcome"],
  { label: string; className: string }
> = {
  MATCHED: { label: "Matched", className: "bg-tint text-ink" },
  UNDERPAID: { label: "Underpaid", className: "bg-surface border border-clay text-clay" },
  NOT_FOUND: { label: "Not found", className: "bg-tint text-clay-deep" },
  UNAVAILABLE: { label: "Gateway down", className: "bg-tint text-clay-deep" },
  /**
   * The most important state on this list, and the reason verifications are
   * stored at all: it is how an order that was confirmed on trust stays
   * visible afterwards instead of looking identical to one that was checked.
   */
  UNCHECKED: { label: "Unchecked", className: "bg-tint text-clay-deep" },
};

export function VerificationBadge({
  verification,
  className,
}: {
  verification: AdminOrderVerificationState;
  className?: string;
}) {
  const tone = VERIFICATION_TONES[verification.outcome];

  return (
    <span
      className={cn(INDICATOR, tone.className, className)}
      title={
        verification.checkedAt
          ? `Checked ${new Date(verification.checkedAt).toLocaleString()}` +
            (verification.checkedByEmail ? ` by ${verification.checkedByEmail}` : " automatically")
          : "The payment gateway has never been asked about this order"
      }
    >
      {tone.label}
    </span>
  );
}

/**
 * Both indicators together, as the queue renders them.
 *
 * Wraps rather than truncates: on a narrow screen two stacked badges are
 * readable, and a clipped "Duplicate" is the one thing this column must never
 * do.
 */
export function PaymentSafetyBadges({
  receipt,
  verification,
  className,
}: {
  receipt: ReceiptUniqueness;
  verification: AdminOrderVerificationState;
  className?: string;
}) {
  /* Cash on delivery gets neither badge. There is no receipt to be unique and
     nothing to verify against a wallet the money never moved through. */
  if (receipt.state === "NOT_APPLICABLE") {
    return <span className="text-muted">—</span>;
  }

  return (
    <span className={cn("flex flex-wrap gap-1", className)}>
      <ReceiptBadge receipt={receipt} />
      <VerificationBadge verification={verification} />
    </span>
  );
}
