import { cva, type VariantProps } from "class-variance-authority";

/* ==========================================================================
   Foundational style primitives

   Class recipes only — no React, no markup. Every component in
   /components/ui renders one of these; nothing here contains a hardcoded
   colour, size or radius. Change a token in /styles/theme.css and every
   component that uses these follows, with no edit in any .tsx file.

   Traceability: each recipe notes the reference page it came from.
   ========================================================================== */

/* --------------------------------------------------------------------------
   Button — Foundations · "Button"
   One primary per view (principle 02). Press feedback is the system's only
   interaction motion: 150ms.
   -------------------------------------------------------------------------- */

export const button = cva(
  [
    "inline-flex items-center justify-center gap-2.5",
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
        sm: "px-5 py-2.5 text-13",
        md: "px-control-x py-control-y text-13.5",
        lg: "px-7 py-3.5 text-13.5",
      },
      block: {
        true: "w-full",
      },
      loading: {
        /* Loading keeps the button clickable-looking but signals waiting. */
        true: "cursor-wait",
      },
    },
    compoundVariants: [
      /* Ghost sits on tighter horizontal padding than the filled variants —
         it has no fill to balance, so 24px reads as a gap, not padding. */
      { variant: ["ghost", "destructive"], size: "sm", class: "px-2.5" },
      { variant: ["ghost", "destructive"], size: "md", class: "px-3" },
      { variant: ["ghost", "destructive"], size: "lg", class: "px-4" },
    ],
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonVariants = VariantProps<typeof button>;

/* --------------------------------------------------------------------------
   Icon button — Foundations, implied by the header actions.
   Square, so the 20px icon box sits centred in a 44px target.
   -------------------------------------------------------------------------- */

export const iconButton = cva(
  [
    "inline-flex shrink-0 items-center justify-center rounded-control",
    "transition-colors duration-150",
    "disabled:pointer-events-none disabled:text-muted",
  ],
  {
    variants: {
      variant: {
        outline: "border border-rule bg-surface text-muted hover:border-ink hover:text-ink",
        ghost: "bg-transparent text-muted hover:bg-tint hover:text-ink",
      },
      size: {
        sm: "size-9",
        md: "size-touch",
      },
    },
    defaultVariants: { variant: "outline", size: "md" },
  },
);

export type IconButtonVariants = VariantProps<typeof iconButton>;

/* --------------------------------------------------------------------------
   Input / Select / Textarea — Foundations · "Input · Select"
   Label in mono caps above, error states the fix below. Focus is signalled by
   the border going ink; `filled` holds that same ink border after blur.
   -------------------------------------------------------------------------- */

export const input = cva(
  [
    "w-full rounded-control border bg-surface",
    "px-field-x py-control-y text-body text-ink",
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
      /* Selects hide the native chevron and leave room for our own. */
      select: {
        true: "appearance-none pr-10 hover:border-ink cursor-pointer",
      },
    },
    defaultVariants: { state: "default" },
  },
);

export type InputVariants = VariantProps<typeof input>;

/** Mono caps field label. */
export const fieldLabel = "eyebrow mb-2.5 block";

/** Helper text under a field. Errors state the fix, never just the fault. */
export const fieldHint = cva("mt-2.5 text-caption", {
  variants: {
    tone: {
      neutral: "text-secondary",
      error: "text-clay",
    },
  },
  defaultVariants: { tone: "neutral" },
});

/* --------------------------------------------------------------------------
   Option list — Foundations · "OPEN MENU"
   The open state of a select: ink-bordered container, 6px padding, items at
   6px radius with the selected row tinted.
   -------------------------------------------------------------------------- */

export const optionList = "rounded-control border border-ink bg-surface p-1.5 text-body";

export const optionItem = cva(
  "block w-full rounded-md px-2.5 py-2.5 text-left transition-colors duration-150",
  {
    variants: {
      selected: {
        true: "bg-tint text-ink",
        false: "text-body hover:bg-tint",
      },
    },
    defaultVariants: { selected: false },
  },
);

/* --------------------------------------------------------------------------
   Card — Foundations · "Card · Modal · Notice"
   White on cream with a 1px rule. There are no shadows in this system.
   -------------------------------------------------------------------------- */

export const card = cva("rounded-container", {
  variants: {
    variant: {
      /** Cards, detail rails, address blocks. */
      surface: "bg-surface border border-rule",
      /** Sections and summaries. Never stacked inside another tinted block. */
      tint: "bg-tint",
      /** The modal panel itself, sitting on the overlay scrim. */
      modal: "bg-page",
    },
    padding: {
      none: "",
      compact: "p-card-compact",
      md: "p-card",
      roomy: "p-card-roomy",
      section: "p-10",
    },
  },
  defaultVariants: { variant: "surface", padding: "md" },
});

export type CardVariants = VariantProps<typeof card>;

/* --------------------------------------------------------------------------
   Status pill — Domain / Foundations. Every state carries a word (principle 03).
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
      /* On a tinted card the pill needs the page cream to separate from it. */
      onTint: {
        true: "",
      },
    },
    compoundVariants: [
      {
        onTint: true,
        status: ["pending", "paid", "shipped"],
        class: "bg-page",
      },
    ],
    defaultVariants: { status: "pending" },
  },
);

export type StatusPillVariants = VariantProps<typeof statusPill>;

/* --------------------------------------------------------------------------
   Metadata badge — Foundations. Mono caps, sits above the title on a card.
   -------------------------------------------------------------------------- */

export const badge = cva(
  /* The transparent border is load-bearing, not a default: `outline` below
     draws a real one, and without a matching border on every other tone that
     badge stands 2px taller than its neighbours. The badge is what a card's
     title sits under, so those 2px became a visible stagger across a grid row
     — the pre-order title one step lower than the three beside it. */
  "inline-flex items-center rounded-md border border-transparent px-2.5 py-1 font-mono text-10 tracking-eyebrow uppercase",
  {
    variants: {
      tone: {
        /** Editor's pick — the one place a badge takes the accent. */
        accent: "bg-clay text-surface",
        /** Last copy, signed, and every other flag. */
        neutral: "bg-tint text-secondary",
        /** On a tinted surface the neutral badge takes the page cream. */
        onTint: "bg-page text-secondary",
        /** Pre-order — an outline rather than a fill, so it reads apart from
            the neutral metadata flags without a second colour. This theme is
            deliberately one-accent (principle 02) and that accent is spoken
            for by editor's pick, so the only texture left to spend here is
            line vs. fill, not a new hue. */
        outline: "border-ink/40 text-ink",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type BadgeVariants = VariantProps<typeof badge>;

/* --------------------------------------------------------------------------
   Filter chip — Page Skeletons · Catalog facets.
   -------------------------------------------------------------------------- */

export const chip = cva(
  [
    "inline-flex items-center rounded-pill px-3.5 py-chip-y",
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
   Count badge — Foundations · header cart count.
   -------------------------------------------------------------------------- */

export const countBadge =
  "inline-flex h-count min-w-count items-center justify-center rounded-pill bg-clay px-1.5 text-11.5 font-semibold text-surface";

/* --------------------------------------------------------------------------
   Notice / toast — Foundations · "TOAST · INLINE NOTICE"
   -------------------------------------------------------------------------- */

export const notice = cva("rounded-notice px-notice-x py-4 text-13.5 leading-relaxed", {
  variants: {
    tone: {
      /** Toast. Ink on cream, with mono meta on the right. */
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
   Choice controls — Foundations · "CHECKBOX · RADIO"
   -------------------------------------------------------------------------- */

/* Both marks are driven off the sibling native input's `:checked` state, so a
   controlled and an uncontrolled control look right without extra wiring. */

export const checkbox = [
  "inline-flex size-choice shrink-0 items-center justify-center",
  "rounded-sm border border-rule bg-surface text-transparent",
  "transition-colors duration-150",
  "peer-checked:border-transparent peer-checked:bg-clay peer-checked:text-surface",
  "peer-disabled:border-rule peer-disabled:bg-tint peer-disabled:text-tint",
  "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink",
].join(" ");

export const radio = [
  "inline-block size-choice shrink-0 rounded-full",
  "border border-rule bg-surface transition-colors duration-150",
  "peer-checked:radio-checked",
  "peer-disabled:border-rule peer-disabled:bg-tint",
  "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink",
].join(" ");

/** Row wrapper for a checkbox or radio and its label. 12px gap, 14px label. */
export const choiceRow = cva("flex items-center gap-3 text-body select-none", {
  variants: {
    disabled: {
      true: "text-muted cursor-not-allowed",
      false: "text-ink cursor-pointer",
    },
  },
  defaultVariants: { disabled: false },
});

/* --------------------------------------------------------------------------
   Quantity stepper — Domain Components · CartItem.
   The border goes ink once the row is engaged.
   -------------------------------------------------------------------------- */

export const stepper = cva(
  "inline-flex items-center rounded-control border bg-surface transition-colors duration-150",
  {
    variants: {
      engaged: {
        true: "border-ink",
        false: "border-rule",
      },
    },
    defaultVariants: { engaged: false },
  },
);

export const stepperButton =
  "px-3 py-2 text-body text-secondary transition-colors duration-150 hover:text-ink disabled:text-muted disabled:pointer-events-none";

/* --------------------------------------------------------------------------
   Spinner — Foundations · "SPINNER"
   22px, 2px rule ring with a clay top edge; inside a primary button the ring
   goes translucent white so it reads on clay.
   -------------------------------------------------------------------------- */

export const spinner = cva("inline-block shrink-0 rounded-full border-2 animate-spin-slow", {
  variants: {
    size: {
      inline: "size-spinner-inline",
      md: "size-spinner",
    },
    tone: {
      default: "border-rule border-t-clay",
      onAccent: "border-surface/40 border-t-surface",
    },
  },
  defaultVariants: { size: "md", tone: "default" },
});

export type SpinnerVariants = VariantProps<typeof spinner>;

/* --------------------------------------------------------------------------
   Order status timeline dot — Domain Components.
   Completed is ink, the live step is clay with a halo, ahead is rule grey.
   -------------------------------------------------------------------------- */

export const timelineDot = cva("size-dot shrink-0 rounded-full", {
  variants: {
    step: {
      complete: "bg-ink",
      live: "bg-clay shadow-live",
      ahead: "bg-page border border-rule",
    },
  },
  defaultVariants: { step: "ahead" },
});

export const timelineConnector = cva("h-px flex-1", {
  variants: {
    step: {
      complete: "bg-ink",
      live: "bg-rule",
      ahead: "bg-rule",
    },
  },
  defaultVariants: { step: "ahead" },
});

export const timelineLabel = cva("text-13.5", {
  variants: {
    step: {
      complete: "text-ink font-semibold",
      live: "text-clay font-semibold",
      ahead: "text-muted",
    },
  },
  defaultVariants: { step: "ahead" },
});

export type TimelineStep = NonNullable<VariantProps<typeof timelineDot>["step"]>;

/* --------------------------------------------------------------------------
   Checkout progress — Cart & Checkout Wireframe (1d).
   Cart → Checkout → Confirmation. Done is a filled ink dot, the current step is
   an ink ring, ahead is a rule ring. The same three-state vocabulary as the
   order timeline, at a smaller rung — but a separate recipe, because this one
   tracks where the shopper is, not where the parcel is.
   -------------------------------------------------------------------------- */

export const progressDot = cva("inline-flex size-choice shrink-0 rounded-full border-[1.5px]", {
  variants: {
    step: {
      done: "border-ink bg-ink",
      current: "border-ink bg-transparent",
      ahead: "border-rule bg-transparent",
    },
  },
  defaultVariants: { step: "ahead" },
});

export const progressLabel = cva("text-caption whitespace-nowrap", {
  variants: {
    step: {
      done: "text-secondary",
      current: "text-ink font-semibold",
      ahead: "text-muted",
    },
  },
  defaultVariants: { step: "ahead" },
});

export type ProgressStep = NonNullable<VariantProps<typeof progressDot>["step"]>;

/* --------------------------------------------------------------------------
   Payment option — Cart & Checkout Wireframe (1d/1e).
   A radio in a card. Selected takes the 1.5px ink border the wireframe draws;
   an unavailable option keeps its shape and says so in words (principle 03)
   rather than disappearing.
   -------------------------------------------------------------------------- */

export const paymentOption = cva(
  [
    "block rounded-control border bg-surface",
    "px-card-compact py-4 transition-colors duration-150",
  ],
  {
    variants: {
      selected: {
        true: "border-[1.5px] border-ink",
        false: "border-rule",
      },
      disabled: {
        true: "bg-page cursor-not-allowed",
        false: "cursor-pointer hover:border-ink",
      },
    },
    defaultVariants: { selected: false, disabled: false },
  },
);

export type PaymentOptionVariants = VariantProps<typeof paymentOption>;

/* --------------------------------------------------------------------------
   Nav link — Foundations · header. Active is ink at 600, never clay.
   -------------------------------------------------------------------------- */

export const navLink = cva("text-13.5 transition-colors duration-150", {
  variants: {
    active: {
      true: "text-ink font-semibold",
      false: "text-secondary hover:text-clay",
    },
  },
  defaultVariants: { active: false },
});
