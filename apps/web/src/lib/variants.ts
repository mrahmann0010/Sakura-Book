import { cva, type VariantProps } from "class-variance-authority";

/* ==========================================================================
   Foundational style primitives

   Class recipes only — no React, no markup. Components are built on top of
   these later. Every value traces to /DESIGN_SYSTEM.md.
   ========================================================================== */

/* --------------------------------------------------------------------------
   Button — one primary per view (principle 02).
   Press feedback is the system's only interaction motion: 150ms.
   -------------------------------------------------------------------------- */

export const button = cva(
  [
    "inline-flex items-center justify-center gap-2",
    "rounded-control font-semibold whitespace-nowrap",
    "min-h-touch", // 44px minimum touch target
    "transition-[background-color,border-color,color,opacity,transform] duration-150",
    "active:scale-[0.98]",
    "disabled:pointer-events-none",
  ],
  {
    variants: {
      variant: {
        primary: "bg-clay text-surface hover:bg-clay-deep disabled:bg-rule disabled:text-muted",
        secondary:
          "bg-surface text-ink border border-rule hover:border-ink disabled:bg-page disabled:text-muted disabled:border-rule",
        ghost: "bg-transparent text-secondary hover:bg-tint hover:text-ink disabled:text-muted",
        destructive: "bg-transparent text-clay hover:bg-tint disabled:text-muted",
      },
      size: {
        /* Ghost sits on tighter horizontal padding than the filled variants. */
        sm: "px-4 py-2.5 text-13",
        md: "px-6 py-[13px] text-13.5",
        lg: "px-6 py-3.5 text-13.5",
      },
      block: {
        true: "w-full",
      },
    },
    compoundVariants: [
      { variant: ["ghost", "destructive"], size: "md", class: "px-3" },
      { variant: ["ghost", "destructive"], size: "lg", class: "px-4" },
    ],
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonVariants = VariantProps<typeof button>;

/* --------------------------------------------------------------------------
   Input / Select — label in mono caps above, error states the fix below.
   Focus is signalled by the border going ink, per the references.
   -------------------------------------------------------------------------- */

export const input = cva(
  [
    "w-full rounded-control border bg-surface",
    "px-3.5 py-[13px] text-sm text-ink",
    "placeholder:text-muted",
    "transition-colors duration-150",
    "focus:border-ink focus:outline-none",
    "disabled:bg-tint disabled:text-muted disabled:cursor-not-allowed",
  ],
  {
    variants: {
      state: {
        default: "border-rule",
        filled: "border-ink",
        error: "border-clay focus:border-clay",
      },
    },
    defaultVariants: { state: "default" },
  },
);

export type InputVariants = VariantProps<typeof input>;

/** Mono caps field label. */
export const fieldLabel = "eyebrow mb-2.5 block";

/** Error helper. States the fix, never just the fault. */
export const fieldError = "mt-2.5 text-caption text-clay";

/* --------------------------------------------------------------------------
   Card — white on cream with a 1px rule. There are no shadows in this system.
   -------------------------------------------------------------------------- */

export const card = cva("rounded-container", {
  variants: {
    variant: {
      /** Cards, modals, detail rails. */
      surface: "bg-surface border border-rule",
      /** Sections and summaries. Never stacked inside another tinted block. */
      tint: "bg-tint",
      /** The modal panel itself, sitting on the overlay scrim. */
      modal: "bg-page",
    },
    padding: {
      compact: "p-5", // 20
      md: "p-6", // 24
      roomy: "p-7", // 28
      section: "p-10", // 40
    },
  },
  defaultVariants: { variant: "surface", padding: "md" },
});

export type CardVariants = VariantProps<typeof card>;

/* --------------------------------------------------------------------------
   Status pill — every state carries a word (principle 03).
   -------------------------------------------------------------------------- */

export const statusPill = cva(
  "inline-flex items-center rounded-pill px-3.5 py-1.5 text-12 font-semibold",
  {
    variants: {
      status: {
        pending: "bg-tint text-secondary",
        paid: "bg-tint text-clay",
        shipped: "bg-tint text-clay",
        delivered: "bg-ink text-page",
        cancelled: "bg-surface text-muted border border-rule",
      },
    },
    defaultVariants: { status: "pending" },
  },
);

export type StatusPillVariants = VariantProps<typeof statusPill>;

/* --------------------------------------------------------------------------
   Metadata badge — mono caps, sits on the cover card.
   -------------------------------------------------------------------------- */

export const badge = cva(
  "inline-flex items-center rounded-md px-2.5 py-[5px] font-mono text-10 tracking-eyebrow",
  {
    variants: {
      tone: {
        /** Editor's pick — the one place a badge takes the accent. */
        accent: "bg-clay text-surface",
        /** Last copy, signed, and every other flag. */
        neutral: "bg-tint text-secondary",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type BadgeVariants = VariantProps<typeof badge>;

/* --------------------------------------------------------------------------
   Filter chip — catalog facets.
   -------------------------------------------------------------------------- */

export const chip = cva(
  [
    "inline-flex items-center rounded-pill px-3.5 py-[7px]",
    "text-caption font-semibold transition-colors duration-150",
  ],
  {
    variants: {
      active: {
        true: "bg-ink text-page",
        false: "bg-tint text-secondary hover:text-ink",
      },
    },
    defaultVariants: { active: false },
  },
);

export type ChipVariants = VariantProps<typeof chip>;

/* --------------------------------------------------------------------------
   Notice / toast
   -------------------------------------------------------------------------- */

export const notice = cva("rounded-notice px-[18px] py-4 text-13.5 leading-relaxed", {
  variants: {
    tone: {
      /** Toast. Ink on cream text, with mono meta on the right. */
      toast: "bg-ink text-page flex items-center justify-between gap-5 py-3.5",
      /** Neutral notices and pending states. */
      info: "bg-tint text-body",
      /** Declined payments and the like. Leading clause goes in clay/600. */
      error: "bg-surface border border-clay text-body",
    },
  },
  defaultVariants: { tone: "info" },
});

export type NoticeVariants = VariantProps<typeof notice>;

/* --------------------------------------------------------------------------
   Choice controls
   -------------------------------------------------------------------------- */

export const checkbox = cva(
  "inline-flex size-[18px] shrink-0 items-center justify-center rounded-sm transition-colors duration-150",
  {
    variants: {
      checked: {
        true: "bg-clay text-surface",
        false: "bg-surface border border-rule",
      },
      disabled: {
        true: "bg-tint border-rule",
      },
    },
    defaultVariants: { checked: false },
  },
);

export const radio = cva("inline-block size-[18px] shrink-0 rounded-full bg-surface", {
  variants: {
    checked: {
      true: "border-[5px] border-clay",
      false: "border border-rule",
    },
  },
  defaultVariants: { checked: false },
});

/* --------------------------------------------------------------------------
   Order status timeline dot
   Completed is ink, the live step is clay, ahead is rule grey.
   -------------------------------------------------------------------------- */

export const timelineDot = cva("size-[11px] shrink-0 rounded-full", {
  variants: {
    step: {
      complete: "bg-ink",
      live: "bg-clay shadow-live",
      ahead: "bg-page border border-rule",
    },
  },
  defaultVariants: { step: "ahead" },
});

export type TimelineDotVariants = VariantProps<typeof timelineDot>;
