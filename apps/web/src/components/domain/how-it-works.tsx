import { cn } from "@/lib/utils";

/**
 * The editorial journey band, per the How It Works Wireframe (option 1a):
 * three stages joined by one continuous thread, not three feature cards.
 *
 * Like ProofPoints this is a full-bleed band rather than a Section — it takes
 * the page background, carries its own padding, and is marked off from the
 * section above by a single top rule. No card, shadow or container border
 * appears anywhere in it: the line art and the whitespace carry the interest.
 *
 * The thread is the whole idea. On desktop it is one hairline running edge to
 * edge behind the illustrations, with a node sitting in each grid gap; the
 * nodes are real grid items in an overlay that mirrors the stage grid's
 * geometry (`1fr 56px 1fr 56px 1fr` is the same track layout as
 * `repeat(3, 1fr)` at `gap: 56px`), so they stay centred at any width instead
 * of being pinned to a hardcoded percentage. On mobile the same thread turns
 * vertical and runs the full height of the list, unbroken from the first
 * stage to the last — a journey that breaks into separate blocks is no longer
 * a journey.
 *
 * Thread and nodes are decorative and aria-hidden; the ordered list carries
 * the sequence for anyone not looking at it.
 */
export function HowItWorks({ eyebrow, title, lede, stages, className }: HowItWorksProps) {
  return (
    <section
      className={cn("hairline bg-page px-6 pt-12 pb-14 lg:px-22 lg:pt-18 lg:pb-21", className)}
      aria-labelledby="how-it-works-title"
    >
      {/* Catalogue-width content inside a full-width band. */}
      <div className="mx-auto w-full max-w-[80rem]">
        {/* Header — heading block left, supporting line right, sharing the
            heading's last baseline. Stacks under desktop. */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-baseline lg:justify-between lg:gap-10">
          <div>
            <p className="text-muted tracking-label text-11 font-mono leading-relaxed uppercase">
              {eyebrow}
            </p>
            <h2
              id="how-it-works-title"
              className="text-ink text-30 lg:text-40 mt-5.5 font-serif leading-[1.1]"
            >
              {title}
            </h2>
          </div>
          <p className="text-secondary text-body max-w-[280px] text-pretty">{lede}</p>
        </div>

        {/* The stage row. `relative` is the thread's positioning context. */}
        <div className="relative mt-11 lg:mt-17">
          <Thread />

          <ol className="relative grid grid-cols-1 gap-11 lg:grid-cols-3 lg:gap-14">
            {stages.map((stage, i) => (
              <li key={stage.number} className="relative pl-15.5 lg:pl-0 lg:text-center">
                {/* Mobile node. Desktop's live in the thread overlay, in the
                    gaps — there is no gap above stage 1 on mobile, so the
                    node sits at the head of each stage instead. */}
                <span
                  aria-hidden="true"
                  className="border-node bg-page absolute top-0 left-[28px] size-[13px] rounded-full border lg:hidden"
                />

                <div className="h-[150px] w-[187px] lg:h-48 lg:w-full">{illustrations[i]}</div>

                <p className="text-muted tracking-label text-11 mt-7 font-mono leading-relaxed">
                  {stage.number}
                </p>
                <h3 className="text-ink text-18 mt-3.5 font-serif">{stage.title}</h3>
                <p className="text-secondary text-body mt-4.5 max-w-[30ch] text-pretty lg:mx-auto">
                  {stage.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

export type HowItWorksStage = {
  /** "01" … "03". Displayed, not derived, so a locale can renumber it. */
  number: string;
  title: string;
  body: string;
};

export type HowItWorksProps = {
  eyebrow: string;
  title: string;
  lede: string;
  /** Exactly three — the band is a three-stage journey. */
  stages: [HowItWorksStage, HowItWorksStage, HowItWorksStage];
  className?: string;
};

/* --------------------------------------------------------------------------
   The thread
   -------------------------------------------------------------------------- */

/**
 * Mobile: a vertical hairline in a 34px left gutter, spanning the full height
 * of the list. Desktop: a horizontal hairline at the illustrations' vertical
 * midpoint (96px into the 192px band), with the two nodes as grid items in
 * the gaps of a grid that matches the stage grid track for track.
 */
function Thread() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {/* Vertical, mobile only. */}
      <span className="bg-rule absolute top-0 bottom-0 left-[34px] w-px lg:hidden" />

      {/* Horizontal, desktop only — edge to edge, behind the illustrations. */}
      <span className="bg-rule absolute top-24 right-0 left-0 hidden h-px lg:block" />

      <div className="absolute inset-x-0 top-[90px] hidden grid-cols-[1fr_3.5rem_1fr_3.5rem_1fr] lg:grid">
        <span />
        <Node />
        <span />
        <Node />
        <span />
      </div>
    </div>
  );
}

function Node() {
  return <span className="border-node bg-page mx-auto block size-[13px] rounded-full border" />;
}

/* --------------------------------------------------------------------------
   Illustrations

   One set, not three drawings: shared 200×160 viewBox, one stroke weight,
   one optical scale, no fills. Non-scaling strokes keep the 1.25px weight
   identical at both the 192px and 150px renders. Each subject is centred on
   y = 80 so the thread reads as passing through the scene.
   -------------------------------------------------------------------------- */

const svgProps = {
  viewBox: "0 0 200 160",
  className: "h-full w-full overflow-visible stroke-ink [vector-effect:non-scaling-stroke]",
  fill: "none",
  strokeWidth: 1.25,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/** 01 — an open book with a lens over one page. */
function FindIllustration() {
  return (
    <svg {...svgProps}>
      <path d="M100 66C86 57 66 54 47 56L43 96C63 94 86 97 100 104" />
      <path d="M100 66c14-9 34-12 53-10l4 40c-20-2-43 1-57 8" />
      <path d="M100 66v38" />
      <path d="M118 75l28-2M119 84l28-2M119 93l20-1" />
      <circle cx="70" cy="77" r="16" />
      <path d="M59 89l-11 12" />
    </svg>
  );
}

/** 02 — a book lowering into a bag, with a confirmation mark. */
function OrderIllustration() {
  return (
    <svg {...svgProps}>
      <g transform="translate(0 5)">
        <path d="M76 41l26-11 24 12-26 11z" />
        <path d="M76 48l24 12 26-11" />
        <path d="M76 41v7M100 53v7M126 42v7" />
        <path d="M70 79c22-3 40-3 62 0l-6 38c-6 3-30 4-50 0z" />
        <path d="M88 79c0-13 26-13 26 0" />
        <path d="M138 88l6 6 12-14" stroke="var(--clay)" />
      </g>
    </svg>
  );
}

/** 03 — a wrapped parcel, a thin path curving in behind it. */
function ReceiveIllustration() {
  return (
    <svg {...svgProps}>
      <path d="M16 122c30 1 40-19 52-30" />
      <path d="M71 61c19-2 39-2 58 0l-2 47c-18 2-36 2-54 0z" />
      <path d="M100 60v48" />
      <path d="M100 60c-6-10-16-8-13-1 2 5 9 2 13 1zM100 60c6-10 16-8 13-1-2 5-9 2-13 1z" />
    </svg>
  );
}

const illustrations = [
  <FindIllustration key="find" />,
  <OrderIllustration key="order" />,
  <ReceiveIllustration key="receive" />,
];
